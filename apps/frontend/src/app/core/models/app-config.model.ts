export interface AppConfig {
  apiUrl: string;
  version: string;
  environment: 'development' | 'production';
  features: {
    [key: string]: boolean;
  };
}
