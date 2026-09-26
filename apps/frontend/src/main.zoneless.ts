import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// Opt-in migration build; production continues to use main.ts until live flows pass.
bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [provideZonelessChangeDetection(), ...appConfig.providers]
});
