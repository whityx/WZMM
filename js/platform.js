const os = require('os');

const platform = os.platform();
const isWindows = platform === 'win32';
const isLinux = platform === 'linux';

const checkGameProcessCommand = isWindows
  ? 'tasklist | findstr /i "ZenlessZoneZero"'
  : 'pgrep -f "ZenlessZoneZero"';

const defaultXxmiPath = isWindows ? 'C:\\XXMI\\ZZMI\\' : '/home/XXMI/ZZMI/';
const defaultXxmiBinPath = isWindows ? 'C:\\XXMI\\Resources\\Bin\\' : '/home/XXMI/Resources/Bin/';

const getConfigDir = () => {
  const path = require('path');
  if (isWindows) {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'wzmm');
  }
  return path.join(os.homedir(), '.config', 'wzmm');
};

module.exports = {
  isWindows,
  isLinux,
  platform,
  checkGameProcessCommand,
  defaultXxmiPath,
  defaultXxmiBinPath,
  getConfigDir
};
