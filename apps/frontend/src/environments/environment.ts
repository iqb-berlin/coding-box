declare global {
  interface Window {
    RUNTIME_CONFIG?: {
      backendUrl?: string;
    };
  }
}

// Standardkonfiguration, die durch Laufzeitkonfiguration überschrieben werden kann
const defaultConfig = {
  production: false,
  backendUrl: 'api'
};

// Überschreiben der Standardkonfiguration mit Laufzeitkonfiguration, falls vorhanden
export const environment = {
  ...defaultConfig,
  backendUrl: window.RUNTIME_CONFIG?.backendUrl || defaultConfig.backendUrl
};
