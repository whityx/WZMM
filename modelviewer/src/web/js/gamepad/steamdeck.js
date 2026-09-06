export function isSteamDeckDevice(gamepad) {
  const isDeckResolution = (window.screen.width === 1280 && window.screen.height === 800) ||
    (window.screen.width === 800 && window.screen.height === 1280);
  const ua = (navigator.userAgent || '').toLowerCase();
  const isDeckUa = ua.includes('steam') || ua.includes('valve') || ua.includes('deck');
  const gpId = (gamepad?.id || '').toLowerCase();
  const isDeckGp = gpId.includes('valve') || gpId.includes('steam') || gpId.includes('057e') || gpId.includes('28de');
  return isDeckResolution || isDeckUa || isDeckGp;
}

export function getDeviceProfile(gamepad) {
  const isRu = (document.documentElement.lang || '').toLowerCase().startsWith('ru');

  if (isSteamDeckDevice(gamepad)) {
    return {
      type: 'steam-deck',
      name: 'Steam Deck',
      helpText: isRu
        ? 'Steam Deck: LS Обзор · RS Панорама · LT/RT Зум · R3 Сброс · X Сетка · Y Скрыть UI · L1/R1 Поворот · B Выход'
        : 'Steam Deck: LS Orbit · RS Pan · LT/RT Zoom · R3 Reset · X Grid · Y Toggle UI · L1/R1 Turn · B Exit',
      deadzone: 0.12,
      orbitSpeed: 2.4,
      panSpeed: 2.8,
      zoomSpeed: 2.2,
    };
  }

  const gpId = (gamepad?.id || '').toLowerCase();
  if (gpId.includes('dualsense') || gpId.includes('wireless controller') || gpId.includes('054c')) {
    return {
      type: 'playstation',
      name: 'DualSense / DualShock',
      helpText: isRu
        ? 'PlayStation: LS Обзор · RS Панорама · L2/R2 Зум · R3 Сброс · ▢ Сетка · △ Скрыть UI · L1/R1 Поворот · ◯ Выход'
        : 'PlayStation: LS Orbit · RS Pan · L2/R2 Zoom · R3 Reset · ▢ Grid · △ Toggle UI · L1/R1 Turn · ◯ Exit',
      deadzone: 0.15,
      orbitSpeed: 2.2,
      panSpeed: 2.6,
      zoomSpeed: 2.0,
    };
  }

  return {
    type: 'standard',
    name: isRu ? 'Геймпад' : 'Gamepad',
    helpText: isRu
      ? 'Геймпад: LS Обзор · RS Панорама · LT/RT Зум · R3 Сброс · X Сетка · Y Скрыть UI · LB/RB Поворот · B Выход'
      : 'Gamepad: LS Orbit · RS Pan · LT/RT Zoom · R3 Reset · X Grid · Y Toggle UI · LB/RB Turn · B Exit',
    deadzone: 0.15,
    orbitSpeed: 2.2,
    panSpeed: 2.6,
    zoomSpeed: 2.0,
  };
}
