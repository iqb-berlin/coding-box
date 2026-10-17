import {
  createEnvironmentInjector, DestroyRef, EnvironmentInjector, importProvidersFrom, inject, Injectable
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { FormlyModule } from '@ngx-formly/core';
import { FormlyMaterialModule } from '@ngx-formly/material';
import {
  DurationService, FormlyChipsComponent, FormlyInlineComponent,
  FormlyToggleComponent, FormlyWrapperPanel, MetadataService
} from '@iqb/metadata-components';
import { createMetadataProfileElement } from './metadata-profile-element';
import { MetadataDurationComponent } from '../components/metadata-duration/metadata-duration.component';

@Injectable({ providedIn: 'root' })
export class MetadataWebComponentService {
  private readonly parent = inject(EnvironmentInjector);
  private readonly destroyRef = inject(DestroyRef);

  ensureRegistered(): void {
    if (customElements.get('metadata-profile-form')) return;
    // Keep translations and Material dialogs in the application's injector hierarchy.
    const injector = createEnvironmentInjector([
      MetadataService,
      DurationService,
      importProvidersFrom(ReactiveFormsModule, FormlyModule.forRoot({
        types: [
          { name: 'chips', component: FormlyChipsComponent, wrappers: ['form-field'] },
          { name: 'formlyToggle', component: FormlyToggleComponent, wrappers: ['form-field'] },
          { name: 'duration', component: MetadataDurationComponent, wrappers: ['form-field'] },
          { name: 'vocabInline', component: FormlyInlineComponent, wrappers: ['form-field'] }
        ],
        wrappers: [{ name: 'panel', component: FormlyWrapperPanel }]
      }), FormlyMaterialModule)
    ], this.parent);
    this.destroyRef.onDestroy(() => injector.destroy());
    customElements.define('metadata-profile-form', createMetadataProfileElement(injector));
  }
}
