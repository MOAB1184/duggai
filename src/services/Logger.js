const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

class Logger {
  constructor(logFilePath) {
    this.logFilePath = logFilePath || path.join(__dirname, '../../app.log');
    // Ensure the log directory exists
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  log(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta
    };
    const line = JSON.stringify(entry);
    
    try {
      fs.appendFileSync(this.logFilePath, line + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }

    // Send to renderer if mainWindow exists
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.webContents.send('log-message', entry);
    }

    // Also log to console for dev
    if (level === 'error') console.error(line);
    else console.log(line);
  }

  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
  debug(msg, meta) { this.log('debug', msg, meta); }
}

module.exports = new Logger(); 