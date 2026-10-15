import { Clipboard } from '@angular/cdk/clipboard';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { XmlViewerComponent } from './xml-viewer.component';

describe('XML viewer without Zone', () => {
  let fixture: ComponentFixture<XmlViewerComponent>;
  let copy: jest.Mock;

  beforeEach(async () => {
    copy = jest.fn().mockReturnValue(true);
    await TestBed.configureTestingModule({
      imports: [XmlViewerComponent, TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection(), { provide: Clipboard, useValue: { copy } }]
    }).compileComponents();
    fixture = TestBed.createComponent(XmlViewerComponent);
    fixture.componentRef.setInput('xml', '<Unit id="SYNTHETIC"/>');
    fixture.autoDetectChanges();
    await fixture.whenStable();
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  function copyButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[aria-label="xml-viewer.copy-xml"]');
  }

  it('clears the copy confirmation after its timer without another click', async () => {
    copyButton().click();
    await fixture.whenStable();
    expect(copyButton().textContent).toContain('done');
    jest.advanceTimersByTime(1500);
    await fixture.whenStable();
    expect(copyButton().textContent).toContain('content_copy');
    expect(copy).toHaveBeenCalledWith('<Unit id="SYNTHETIC"/>');
  });

  it('retains the new copy confirmation when the previous timer expires', async () => {
    copyButton().click();
    await fixture.whenStable();
    jest.advanceTimersByTime(1000);
    copyButton().click();
    await fixture.whenStable();
    jest.advanceTimersByTime(500);
    await fixture.whenStable();
    expect(copyButton().textContent).toContain('done');
    expect(fixture.componentInstance.copySucceeded()).toBe(true);
    jest.advanceTimersByTime(1000);
    await fixture.whenStable();
    expect(copyButton().textContent).toContain('content_copy');
  });

  it('clears a previous confirmation when copying fails', async () => {
    copyButton().click();
    await fixture.whenStable();
    copy.mockReturnValue(false);
    copyButton().click();
    await fixture.whenStable();
    expect(copyButton().textContent).toContain('content_copy');
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each([
    ['<Unit id="REPLACEMENT"/>', 'REPLACEMENT', false],
    ['', '', false],
    ['<Unit>', '<Unit>', true]
  ] as const)('updates rendered XML when the input becomes %s', async (xml, content, warning) => {
    fixture.componentRef.setInput('xml', xml);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.xml-code').textContent).toContain(content);
    expect(fixture.nativeElement.querySelector('.parse-warning') !== null).toBe(warning);
    expect(fixture.nativeElement.querySelector('.xml-code').textContent).not.toContain('SYNTHETIC');
  });

  it('toggles line wrapping through the toolbar', async () => {
    const button = fixture.nativeElement.querySelector('[aria-label="xml-viewer.toggle-line-wrap"]');
    button.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.xml-code.wrap')).not.toBeNull();
    button.click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.xml-code.wrap')).toBeNull();
  });

  it('cancels the pending copy reset when destroyed', async () => {
    copyButton().click();
    await fixture.whenStable();
    fixture.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });
});
