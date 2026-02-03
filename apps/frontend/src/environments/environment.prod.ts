// Standardkonfiguration, die durch Laufzeitkonfiguration überschrieben werden kann
const defaultConfig = {
  production: true,
  backendUrl: 'api'
};

// Überschreiben der Standardkonfiguration mit Laufzeitkonfiguration, falls vorhanden
export const environment = {
  ...defaultConfig
};
