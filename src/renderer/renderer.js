const participantsEl = document.getElementById('participants');
const logEl = document.getElementById('log');

function appendLog(data) {
  logEl.textContent += JSON.stringify(data) + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function renderParticipants(list) {
  participantsEl.innerHTML = '';
  for (const name of list) {
    const li = document.createElement('li');
    li.textContent = name;
    participantsEl.appendChild(li);
  }
}

window.api.onData((data) => {
  appendLog(data);
  if (data.type === 'participants' && Array.isArray(data.participants)) {
    renderParticipants(data.participants);
  }
});

document.getElementById('btn-start').addEventListener('click', () => window.api.start());
document.getElementById('btn-stop').addEventListener('click', () => window.api.stop());
document.getElementById('btn-poll').addEventListener('click', () => {
  window.api.sendCommand({ action: 'pollOnce' });
});
