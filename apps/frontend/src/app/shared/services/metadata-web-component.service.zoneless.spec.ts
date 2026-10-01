import { EnvironmentInjector, provideZonelessChangeDetection } from '@angular/core';
import { createCustomElement } from '@angular/elements';
import { TestBed } from '@angular/core/testing';
import { MetadataService } from '@iqb/metadata-components';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MetadataWebComponentService } from './metadata-web-component.service';

jest.mock('@angular/elements', () => ({
  createCustomElement: jest.fn(() => class {
    constructor(public injector: EnvironmentInjector) {}
  })
}));

describe('Metadata web component registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection()]
    });
    jest.spyOn(customElements, 'get').mockReturnValue(undefined);
    jest.spyOn(customElements, 'define').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('inherits the application translation service and registers only once', () => {
    const service = TestBed.inject(MetadataWebComponentService);
    service.ensureRegistered();
    const factory = createCustomElement as jest.Mock;
    const injector = factory.mock.calls[0][1].injector as EnvironmentInjector;
    expect(injector.get(TranslateService)).toBe(TestBed.inject(TranslateService));
    expect(customElements.define).toHaveBeenCalledWith('metadata-profile-form', expect.any(Function));
    jest.mocked(customElements.get).mockReturnValue(factory.mock.results[0].value);
    service.ensureRegistered();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('destroys its child injector when the application is destroyed', () => {
    TestBed.inject(MetadataWebComponentService).ensureRegistered();
    const injector = (createCustomElement as jest.Mock).mock.calls[0][1].injector as EnvironmentInjector;
    TestBed.resetTestingModule();
    expect(() => injector.get(TranslateService)).toThrow(/destroyed/);
  });

  it('isolates the vocabulary service of every element while inheriting translations', () => {
    TestBed.inject(MetadataWebComponentService).ensureRegistered();
    const Element = jest.mocked(customElements.define).mock.calls[0][1] as unknown as
      new () => { injector: EnvironmentInjector };
    const first = new Element();
    const second = new Element();
    expect(first.injector.get(MetadataService)).not.toBe(second.injector.get(MetadataService));
    expect(first.injector.get(TranslateService)).toBe(TestBed.inject(TranslateService));
    expect(second.injector.get(TranslateService)).toBe(TestBed.inject(TranslateService));
  });
});
