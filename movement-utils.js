function roundWindowCoordinate(rawValue) {
  const rounded = Math.round(Number(rawValue));
  // Math.round(-0.1) は -0 になる。ElectronのsetPositionは -0 を
  // 整数へ変換できず例外にするため、通常の0へそろえる。
  return Object.is(rounded, -0) ? 0 : rounded;
}

module.exports = { roundWindowCoordinate };
