// ==================================================================
//  CONFIG – UPDATE YOUR SUPABASE DETAILS
// ==================================================================
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";   // CHANGE
const SUPABASE_KEY = "YOUR-API-KEY";                       // CHANGE
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DEVICE_ID = "esp32-local";  // must be same in ESP32 code



// ==================================================================
//  SESSION CHECK – ONLY ALLOW IF LOGGED IN
// ==================================================================
(function ensureSession() {
  const email = sessionStorage.getItem("userEmail");
  if (!email) {
    window.location.href = "index.html"; // redirect login
  }
  document.getElementById("deviceId").textContent = DEVICE_ID;
})();



// ==================================================================
//  DATE & TIME
// ==================================================================
function updateDateTime() {
  document.getElementById("dateTime").textContent = new Date().toLocaleString();
}
setInterval(updateDateTime, 1000);
updateDateTime();



// ==================================================================
//  LOGOUT
// ==================================================================
async function logout() {
  sessionStorage.clear();
  window.location.href = "index.html";
}



// ==================================================================
//  REMOTE RELAY CONTROL – WRITE COMMANDS INTO TABLE “commands”
// ==================================================================
async function sendRelayCommand(relayNum, status) {
  await supabaseClient.from("commands").insert([
    {
      device_id: DEVICE_ID,
      relay: relayNum,
      status: status ? "ON" : "OFF",
      timestamp: new Date()
    }
  ]);
}

["relay1", "relay2", "relay3", "relay4"].forEach((id, index) => {
  document.getElementById(id).addEventListener("change", (e) => {
    sendRelayCommand(index + 1, e.target.checked);
  });
});



// ==================================================================
//  AUTO-OFF TIMER (SLEEP MODE) – TABLE "timers"
// ==================================================================
document.querySelectorAll(".preset").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("customMin").value = btn.dataset.min;
  });
});

document.getElementById("applyTimer").addEventListener("click", async () => {
  const min = parseInt(document.getElementById("customMin").value);
  const load = parseInt(document.getElementById("loadSelect").value);
  if (!min || min < 1) return alert("Enter valid time");

  await supabaseClient.from("timers").insert([
    {
      device_id: DEVICE_ID,
      relay: load,
      minutes: min,
      set_time: new Date()
    }
  ]);

  alert(`Timer set for Load ${load} – ${min} minutes`);
});



// ==================================================================
//  LIMIT SAVE  (TABLE: usage_limits)
// ==================================================================
document.getElementById("saveLimits").addEventListener("click", async () => {
  const limits = {
    1: document.getElementById("limit1").value,
    2: document.getElementById("limit2").value,
    3: document.getElementById("limit3").value,
    4: document.getElementById("limit4").value
  };

  for (const relay in limits) {
    await supabaseClient.from("usage_limits").upsert({
      device_id: DEVICE_ID,
      relay: parseInt(relay),
      limit_hours: limits[relay],
    });
  }

  alert("Limits updated successfully");
});



// ==================================================================
//  LIVE READINGS  (TABLE: power_data)
// ==================================================================
async function fetchLiveData() {
  const { data, error } = await supabaseClient
    .from("power_data")
    .select("*")
    .eq("device_id", DEVICE_ID)
    .order("id", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return;

  const d = data[0]; // latest row from ESP32

  // Fill UI
  for (let i = 1; i <= 4; i++) {
    document.getElementById(`v${i}`).textContent = d[`voltage${i}`] + "V";
    document.getElementById(`c${i}`).textContent = d[`current${i}`] + "A";
    document.getElementById(`p${i}`).textContent = d[`power${i}`] + "W";
    document.getElementById(`e${i}`).textContent = d[`energy${i}`] + "Wh";
    document.getElementById(`s${i}`).textContent = d[`status${i}`];
  }

  document.getElementById("tv").textContent = d.total_voltage + "V";
  document.getElementById("tc").textContent = d.total_current + "A";
  document.getElementById("tp").textContent = d.total_power + "W";
  document.getElementById("te").textContent = d.total_energy + "Wh";
}

setInterval(fetchLiveData, 3000); // every 3 sec
fetchLiveData();



// ==================================================================
//  CHART FILTERS & PDF EXPORT
// ==================================================================
let myChart = null;

async function loadChart() {
  const filter = document.getElementById("filterSelect").value;
  const chartType = document.getElementById("chartType").value;
  let query = supabaseClient.from("power_data").select("*").eq("device_id", DEVICE_ID);

  if (filter === "day") {
    const day = document.getElementById("singleDay").value;
    query = query.gte("timestamp", day + " 00:00").lte("timestamp", day + " 23:59");
  }
  else if (filter === "month") {
    const m = document.getElementById("singleMonth").value;
    query = query.gte("timestamp", m + "-01").lte("timestamp", m + "-31");
  }

  const { data } = await query;

  if (!data || data.length === 0) {
    document.getElementById("chartResults").textContent = "No data found.";
    return;
  }

  document.getElementById("chartResults").textContent = `${data.length} records`;

  const labels = data.map(d => new Date(d.timestamp).toLocaleString());
  const power = data.map(d => d.total_power);

  if (myChart) myChart.destroy();
  const ctx = document.getElementById("chart").getContext("2d");
  myChart = new Chart(ctx, {
    type: chartType,
    data: {
      labels,
      datasets: [{
        label: "Total Power (W)",
        data: power,
        borderWidth: 1,
      }]
    }
  });
}

document.getElementById("loadCharts").addEventListener("click", loadChart);

document.getElementById("downloadPdf").addEventListener("click", () => {
  const pdf = new jspdf.jsPDF();
  pdf.text("Power Usage Report", 10, 10);
  pdf.addImage(document.getElementById("chart"), "PNG", 10, 20, 180, 120);
  pdf.save("Power-Report.pdf");
});



// ==================================================================
//  NOTIFICATIONS  (TABLE: notifications)
// ==================================================================
async function loadNotifs() {
  const { data } = await supabaseClient
    .from("notifications")
    .select("*")
    .eq("device_id", DEVICE_ID)
    .order("id", { ascending: false });

  const ul = document.getElementById("notifs");
  ul.innerHTML = "";
  if (!data || data.length === 0) return (ul.innerHTML = "<li>No notifications yet.</li>");

  data.forEach(n => {
    const li = document.createElement("li");
    li.textContent = `${n.message}  (${n.timestamp})`;
    ul.appendChild(li);
  });
}

document.getElementById("refreshNotifs").addEventListener("click", loadNotifs);
document.getElementById("clearNotifs").addEventListener("click", async () => {
  await supabaseClient.from("notifications").delete().eq("device_id", DEVICE_ID);
  loadNotifs();
});

loadNotifs(); // first load
