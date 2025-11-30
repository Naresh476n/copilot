const relayButtons = document.querySelectorAll(".relay-btn");

relayButtons.forEach(btn => {
  btn.addEventListener("click", async () => {
    const relay = btn.dataset.relay;
    const state = btn.dataset.state;

    const { data, error } = await supabase
      .from("commands")
      .insert([{ relay: Number(relay), state }]);

    if (error) {
      alert("Error sending command");
    } else {
      alert(`Relay ${relay} switched ${state}`);
    }
  });
});
