import { Injector } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { MetadataService, ProfileFormComponent } from '@iqb/metadata-components';

export function createMetadataProfileElement(injector: Injector): CustomElementConstructor {
  const ProfileElement: new (elementInjector?: Injector) => HTMLElement =
    createCustomElement(ProfileFormComponent, { injector });
  // Vocabulary state belongs to each form, including dialogs opened after another form closes.
  return class extends ProfileElement {
    constructor() {
      super(Injector.create({ providers: [MetadataService], parent: injector }));
    }
  };
}
