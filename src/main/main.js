const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

let mainWindow = null;
let pyProcess = null;
let stdoutBuffer = '';

function getScraperCommand() {
  if (app.isPackaged) {
    // 배포 단계: pyinstaller로 빌드된 exe를 resources 폴더에서 직접 실행
    return { cmd: path.join(process.resourcesPath, 'scraper.exe'), args: [] };
  }
  // 개발 단계: py 런처로 스크립트 실행
  // ('python'은 Windows Store 별칭(App Execution Alias)과 충돌해 9009로 죽는 경우가 있어 'py' 사용)
  return { cmd: 'py', args: [path.join(__dirname, '..', '..', 'automation', 'scraper.py')] };
}

function startScraper() {
  if (pyProcess) return;

  const { cmd, args } = getScraperCommand();
  pyProcess = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });

  pyProcess.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // 마지막 미완성 라인은 버퍼에 남겨둠

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const data = JSON.parse(trimmed);
        if (mainWindow) mainWindow.webContents.send('scraper:data', data);
      } catch (err) {
        console.error('[scraper] JSON parse 실패:', trimmed);
      }
    }
  });

  pyProcess.stderr.on('data', (chunk) => {
    console.error('[scraper:stderr]', chunk.toString());
  });

  pyProcess.on('error', (err) => {
    console.error('[scraper] 프로세스 실행 실패:', err);
    pyProcess = null;
  });

  pyProcess.on('close', (code) => {
    console.log(`[scraper] 프로세스 종료 (code=${code})`);
    pyProcess = null;
  });
}

function stopScraper() {
  if (!pyProcess) return;
  const pid = pyProcess.pid;

  if (process.platform === 'win32') {
    // pyinstaller --onefile은 부트로더가 실제 프로세스를 자식으로 다시 띄우므로
    // 단순 kill()로는 손자 프로세스가 남을 수 있음 -> 트리 전체를 강제 종료
    exec(`taskkill /pid ${pid} /t /f`, (err) => {
      if (err) console.error('[scraper] taskkill 실패:', err.message);
    });
  } else {
    pyProcess.kill('SIGTERM');
  }

  pyProcess = null;
}

function sendCommand(command) {
  if (!pyProcess || !pyProcess.stdin.writable) {
    return { ok: false, message: 'scraper process not running' };
  }
  pyProcess.stdin.write(JSON.stringify(command) + '\n');
  return { ok: true };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }
}

function getRosterPath() {
  return path.join(app.getPath('userData'), 'roster.json');
}

ipcMain.handle('scraper:start', () => {
  startScraper();
  return { ok: true };
});

ipcMain.handle('scraper:stop', () => {
  stopScraper();
  return { ok: true };
});

ipcMain.handle('scraper:command', (_event, command) => sendCommand(command));

ipcMain.handle('roster:load', () => {
  try {
    return JSON.parse(fs.readFileSync(getRosterPath(), 'utf-8'));
  } catch (err) {
    return [];
  }
});

ipcMain.handle('roster:save', (_event, rows) => {
  fs.writeFileSync(getRosterPath(), JSON.stringify(rows, null, 2), 'utf-8');
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  startScraper();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopScraper();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopScraper();
});
