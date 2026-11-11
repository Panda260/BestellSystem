// Kitchen planning for the TV view: countdowns, estimated ready times and
// remaining capacity until the end of the lunch break.
//
// Model:
// - Oven ("oven"): N slots, filled continuously. A slot is busy for the
//   cooking time, then needs `changeMinutes` before the next pizza goes in.
// - Fryer ("fryer"): batches of up to N pieces (also across orders). A running
//   batch is closed — nothing can be added. A single waiting piece starts alone
//   if the fryer is free. After each batch `changeMinutes` for the swap.
// - Waiting items are planned in order of their order's createdAt.

const MIN = 60 * 1000;

// Epoch ms for today's HH:MM in Europe/Berlin (independent of device timezone)
function berlinTimeToday(hhmm, nowMs) {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value])
  );
  // Offset of Berlin wall time vs. UTC at "now"
  const berlinAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = berlinAsUtc - Math.floor(nowMs / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day, h, m) - offset;
}

function itemKey(orderId, index) {
  return `${orderId}:${index}`;
}

/**
 * @param {Array} orders   active orders (as sent to the TV)
 * @param {number} now     current time (ms, server-corrected)
 * @param {object} cfg     { ovenSlots, fryerSlots, changeMinutes, pauseStart, pauseEnd,
 *                           ovenCapacityMinutes, fryerCapacityMinutes }
 * @returns {{ items: Map, orderEta: Map, capacity: {oven:number, fryer:number},
 *             pauseStartMs:number, pauseEndMs:number }}
 */
function planKitchen(orders, now, cfg) {
  const change = Math.max(0, Number(cfg.changeMinutes) || 0) * MIN;
  const ovenSlots = Math.max(1, Number(cfg.ovenSlots) || 1);
  const fryerSlots = Math.max(1, Number(cfg.fryerSlots) || 1);
  const pauseStartMs = berlinTimeToday(cfg.pauseStart, now);
  const pauseEndMs = berlinTimeToday(cfg.pauseEnd, now);
  // Nothing goes into the oven before the break starts
  const origin = Math.max(now, pauseStartMs);

  const items = new Map();   // key -> { state, station, endsAt, startsAt }
  const orderEta = new Map(); // orderId -> latest planned end of its open items

  const waiting = { oven: [], fryer: [] };
  const running = { oven: [], fryer: [] };

  const sorted = [...orders].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  sorted.forEach((o) => {
    o.items.forEach((it, index) => {
      if (it.pickedUp) return;
      const key = itemKey(o.id, index);
      if (it.done) {
        items.set(key, { state: "done", station: it.station });
        return;
      }
      const cook = Number(it.cookMinutes) * MIN;
      if (!it.station || !cook) return; // not plannable (e.g. drinks)
      if (it.inOven) {
        // Items marked before this feature existed have no start time:
        // assume they just went in (conservative).
        const started = it.ovenStartedAt ? new Date(it.ovenStartedAt).getTime() : now;
        const endsAt = started + cook;
        items.set(key, { state: "cooking", station: it.station, endsAt, hasStart: !!it.ovenStartedAt });
        running[it.station]?.push(endsAt);
      } else {
        waiting[it.station]?.push({ key, orderId: o.id, cook });
      }
    });
  });

  const noteEta = (orderId, endsAt) => {
    orderEta.set(orderId, Math.max(orderEta.get(orderId) || 0, endsAt));
  };
  // Cooking items count for the order's ETA too
  sorted.forEach((o) => o.items.forEach((it, index) => {
    const info = items.get(itemKey(o.id, index));
    if (info?.state === "cooking") noteEta(o.id, info.endsAt);
  }));

  // ---- Oven: continuous slots ----
  const slots = running.oven.map((end) => Math.max(end, now) + change);
  while (slots.length < ovenSlots) slots.push(origin);
  const takeSlot = () => {
    let best = 0;
    for (let i = 1; i < slots.length; i++) if (slots[i] < slots[best]) best = i;
    return best;
  };
  waiting.oven.forEach((w) => {
    const i = takeSlot();
    const startsAt = Math.max(slots[i], origin);
    const endsAt = startsAt + w.cook;
    slots[i] = endsAt + change;
    items.set(w.key, { state: "waiting", station: "oven", startsAt, endsAt });
    noteEta(w.orderId, endsAt);
  });
  // Capacity: how many more pizzas fit until the break ends
  let ovenCap = 0;
  const ovenCook = (Number(cfg.ovenCapacityMinutes) || 10) * MIN;
  for (let guard = 0; guard < 500; guard++) {
    const i = takeSlot();
    const startsAt = Math.max(slots[i], origin);
    if (startsAt + ovenCook > pauseEndMs) break;
    slots[i] = startsAt + ovenCook + change;
    ovenCap++;
  }

  // ---- Fryer: closed batches ----
  let fryerFree = running.fryer.length
    ? Math.max(Math.max(...running.fryer), now) + change
    : origin;
  let lastBatch = null; // { startsAt, size }
  for (let i = 0; i < waiting.fryer.length; i += fryerSlots) {
    const batch = waiting.fryer.slice(i, i + fryerSlots);
    const startsAt = Math.max(fryerFree, origin);
    const endsAt = startsAt + Math.max(...batch.map((b) => b.cook));
    batch.forEach((b) => {
      items.set(b.key, { state: "waiting", station: "fryer", startsAt, endsAt });
      noteEta(b.orderId, endsAt);
    });
    fryerFree = endsAt + change;
    lastBatch = { startsAt, size: batch.length };
  }
  // Capacity: free seats in a not-yet-started last batch + full batches after it
  let fryerCap = 0;
  const fryerCook = (Number(cfg.fryerCapacityMinutes) || 6) * MIN;
  if (lastBatch && lastBatch.size < fryerSlots && lastBatch.startsAt > now
      && lastBatch.startsAt + fryerCook <= pauseEndMs) {
    fryerCap += fryerSlots - lastBatch.size;
  }
  for (let guard = 0; guard < 500; guard++) {
    const startsAt = Math.max(fryerFree, origin);
    if (startsAt + fryerCook > pauseEndMs) break;
    fryerFree = startsAt + fryerCook + change;
    fryerCap += fryerSlots;
  }

  return { items, orderEta, capacity: { oven: ovenCap, fryer: fryerCap }, pauseStartMs, pauseEndMs };
}

// Export for Node (tests) while staying a plain browser script
if (typeof module !== "undefined") module.exports = { planKitchen, berlinTimeToday, itemKey };
