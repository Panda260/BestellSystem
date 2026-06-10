document.getElementById("status-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = document.getElementById("order-id").value.trim();
  if (/^\d+$/.test(value)) {
    window.location.href = `/${value}`;
  }
});
