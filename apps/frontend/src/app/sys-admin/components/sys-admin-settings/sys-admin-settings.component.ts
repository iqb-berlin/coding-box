import { Component, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService, standardLogo } from '../../../services/app.service';
import { LogoService } from '../../../services/logo.service';
import { AppLogoDto } from '../../../../../../../api-dto/app-logo-dto';

@Component({
  selector: 'coding-box-sys-admin-settings',
  templateUrl: './sys-admin-settings.component.html',
  styleUrls: ['./sys-admin-settings.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule
  ]
})
export class SysAdminSettingsComponent {
  appService = inject(AppService);
  private logoService = inject(LogoService);
  private snackBar = inject(MatSnackBar);

  selectedFile: File | null = null;
  previewUrl: string | null = null;
  isDefaultLogo = true;
  logoAltText = '';
  backgroundColorValue = '';
  private readonly ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];

  constructor() {
    this.isDefaultLogo = this.appService.appLogo.data === standardLogo.data;
    this.logoAltText = this.appService.appLogo.alt;
    this.backgroundColorValue = this.appService.appLogo.bodyBackground || '';
  }

  /**
   * Handles file selection for logo upload
   * @param event The file input change event
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];

      if (!this.ALLOWED_MIME_TYPES.includes(this.selectedFile.type)) {
        this.snackBar.open('Bitte wählen Sie eine gültige Bilddatei aus (JPEG, PNG, GIF, SVG, WebP).', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      if (this.selectedFile.size > 4 * 1024 * 1024) {
        this.snackBar.open('Die Datei ist zu groß. Maximale Größe: 4MB', 'Schließen', { duration: 3000 });
        this.resetFileInput();
        return;
      }

      // Create preview
      this.createImagePreview();
    }
  }

  /**
   * Creates a preview of the selected image
   */
  private createImagePreview(): void {
    if (!this.selectedFile) return;

    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = reader.result as string;
    };
    reader.readAsDataURL(this.selectedFile);
  }

  /**
   * Resets the file input
   */
  resetFileInput(): void {
    this.selectedFile = null;
    this.previewUrl = null;
    // Reset the file input element
    const fileInput = document.getElementById('logo-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  /**
   * Uploads the selected logo
   */
  uploadLogo(): void {
    if (!this.selectedFile || !this.previewUrl) return;

    this.logoService.uploadLogo(this.selectedFile).subscribe({
      next: response => {
        const newLogo: AppLogoDto = {
          data: response.path,
          alt: this.logoAltText,
          bodyBackground: this.backgroundColorValue,
          boxBackground: this.appService.appLogo.boxBackground
        };

        // Update the appLogo property in the AppService
        this.appService.appLogo = newLogo;
        this.isDefaultLogo = false;

        // Save the logo settings to the server
        this.logoService.saveLogoSettings(newLogo).subscribe({
          next: settingsResponse => {
            if (settingsResponse.success) {
              this.snackBar.open('Logo erfolgreich aktualisiert', 'Schließen', { duration: 3000 });
            } else {
              this.snackBar.open('Logo aktualisiert, aber Fehler beim Speichern der Einstellungen', 'Schließen', { duration: 3000 });
            }
            this.resetFileInput();
          },
          error: settingsError => {
            console.error('Error saving logo settings:', settingsError);
            this.snackBar.open('Logo aktualisiert, aber Fehler beim Speichern der Einstellungen', 'Schließen', { duration: 3000 });
            this.resetFileInput();
          }
        });
      },
      error: error => {
        console.error('Error uploading logo:', error);
        this.snackBar.open('Fehler beim Hochladen des Logos', 'Schließen', { duration: 3000 });
      }
    });
  }

  /**
   * Resets to the default logo
   */
  resetToDefaultLogo(): void {
    this.logoService.deleteLogo().subscribe({
      next: response => {
        if (response.success) {
          this.appService.appLogo = standardLogo;
          this.isDefaultLogo = true;
          this.logoAltText = standardLogo.alt;
          this.backgroundColorValue = standardLogo.bodyBackground || '';
          this.snackBar.open('Standard-Logo wiederhergestellt', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Zurücksetzen des Logos', 'Schließen', { duration: 3000 });
        }
        this.resetFileInput();
      },
      error: error => {
        console.error('Error resetting logo:', error);
        this.snackBar.open('Fehler beim Zurücksetzen des Logos', 'Schließen', { duration: 3000 });
      }
    });
  }

  /**
   * Saves the alternative text for the logo
   */
  saveAltText(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      alt: this.logoAltText
    };

    // Update the appLogo property in the AppService
    this.appService.appLogo = updatedLogo;

    // Save the logo settings to the server
    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Alternativtext erfolgreich gespeichert', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Speichern des Alternativtexts', 'Schließen', { duration: 3000 });
        }
      },
      error: error => {
        console.error('Error saving alt text:', error);
        this.snackBar.open('Fehler beim Speichern des Alternativtexts', 'Schließen', { duration: 3000 });
      }
    });
  }

  /**
   * Updates the background color preview when the input changes
   */
  updateBackgroundPreview(): void {
    // The preview is automatically updated through data binding
    // This method is called when the input changes
  }

  /**
   * Saves the background color for the application
   */
  saveBackgroundColor(): void {
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue
    };

    // Update the appLogo property in the AppService
    this.appService.appLogo = updatedLogo;

    // Save the logo settings to the server
    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Hintergrundfarbe erfolgreich gespeichert', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Speichern der Hintergrundfarbe', 'Schließen', { duration: 3000 });
        }
      },
      error: error => {
        console.error('Error saving background color:', error);
        this.snackBar.open('Fehler beim Speichern der Hintergrundfarbe', 'Schließen', { duration: 3000 });
      }
    });
  }

  /**
   * Resets the background color to the standard linear gradient
   */
  resetToDefaultBackground(): void {
    // Set the background color value to the standard gradient from standardLogo
    this.backgroundColorValue = standardLogo.bodyBackground || '';

    // Create updated logo object with default background
    const updatedLogo = {
      ...this.appService.appLogo,
      bodyBackground: this.backgroundColorValue
    };

    // Update the appLogo property in the AppService
    this.appService.appLogo = updatedLogo;

    // Save the logo settings to the server
    this.logoService.saveLogoSettings(updatedLogo).subscribe({
      next: response => {
        if (response.success) {
          this.snackBar.open('Hintergrundfarbe auf Standard zurückgesetzt', 'Schließen', { duration: 3000 });
        } else {
          this.snackBar.open('Fehler beim Zurücksetzen der Hintergrundfarbe', 'Schließen', { duration: 3000 });
        }
      },
      error: error => {
        console.error('Error resetting background color:', error);
        this.snackBar.open('Fehler beim Zurücksetzen der Hintergrundfarbe', 'Schließen', { duration: 3000 });
      }
    });
  }
}
