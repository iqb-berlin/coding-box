import * as packageInfo from '../../../../package.json';

const packageVersion = (
  (packageInfo as unknown as { default?: { version: string } }).default ||
  (packageInfo as unknown as { version: string })
).version;

declare global {
  interface Window {
    RUNTIME_CONFIG?: {
      keycloak?: {
        url: string;
        realm: string;
        clientId: string;
      };
      appVersion?: string;
      backendUrl?: string;
    };
  }
}

// Standardkonfiguration, die durch Laufzeitkonfiguration überschrieben werden kann
const defaultConfig = {
  production: true,
  appVersion: packageVersion,
  backendUrl: 'api/',
  keycloak: {
    url: 'https://keycloak.kodierbox.iqb.hu-berlin.de/',
    realm: 'coding-box',
    clientId: 'coding-box'
  }
};

// Überschreiben der Standardkonfiguration mit Laufzeitkonfiguration, falls vorhanden
export const environment = {
  ...defaultConfig,
  appVersion: window.RUNTIME_CONFIG?.appVersion || defaultConfig.appVersion,
  backendUrl: window.RUNTIME_CONFIG?.backendUrl || defaultConfig.backendUrl,
  keycloak: {
    url: window.RUNTIME_CONFIG?.keycloak?.url || defaultConfig.keycloak.url,
    realm: window.RUNTIME_CONFIG?.keycloak?.realm || defaultConfig.keycloak.realm,
    clientId: window.RUNTIME_CONFIG?.keycloak?.clientId || defaultConfig.keycloak.clientId
  }
};
