import { Clipboard } from '@angular/cdk/clipboard';
import {
  ComponentFixture, fakeAsync, TestBed, tick
} from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { XmlViewerComponent } from './xml-viewer.component';

describe('XmlViewerComponent', () => {
  let component: XmlViewerComponent;
  let fixture: ComponentFixture<XmlViewerComponent>;
  let clipboard: { copy: jest.Mock };

  beforeEach(async () => {
    clipboard = { copy: jest.fn().mockReturnValue(true) };

    await TestBed.configureTestingModule({
      imports: [XmlViewerComponent, NoopAnimationsModule, TranslateModule.forRoot()],
      providers: [
        { provide: Clipboard, useValue: clipboard }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(XmlViewerComponent);
    component = fixture.componentInstance;
  });

  it('should pretty-print valid XML', () => {
    fixture.componentRef.setInput('xml', '<Unit><Metadata id="u1"/><Definition><Value>42</Value></Definition></Unit>');

    fixture.detectChanges();

    expect(component.hasParseError).toBe(false);
    expect(component.formattedXml).toBe([
      '<Unit>',
      '  <Metadata id="u1"/>',
      '  <Definition>',
      '    <Value>42</Value>',
      '  </Definition>',
      '</Unit>'
    ].join('\n'));
  });

  it('should keep raw XML when parsing fails', () => {
    fixture.componentRef.setInput('xml', '<Unit><Metadata></Unit>');

    fixture.detectChanges();

    expect(component.hasParseError).toBe(true);
    expect(component.formattedXml).toBe('<Unit><Metadata></Unit>');
  });

  it('should pretty-print XML without splitting tags on greater-than signs in attributes', () => {
    fixture.componentRef.setInput('xml', '<Unit><Metadata label="a > b"/></Unit>');

    fixture.detectChanges();

    expect(component.hasParseError).toBe(false);
    expect(component.formattedXml).toBe([
      '<Unit>',
      '  <Metadata label="a > b"/>',
      '</Unit>'
    ].join('\n'));
  });

  it('should keep DOCTYPE internal subsets together', () => {
    fixture.componentRef.setInput('xml', '<!DOCTYPE Unit [<!ELEMENT Unit ANY>]><Unit/>');

    fixture.detectChanges();

    expect(component.hasParseError).toBe(false);
    expect(component.formattedXml).toBe([
      '<!DOCTYPE Unit [<!ELEMENT Unit ANY>]>',
      '<Unit/>'
    ].join('\n'));
  });

  it('should toggle line wrapping', () => {
    expect(component.lineWrap).toBe(false);

    component.toggleLineWrap();

    expect(component.lineWrap).toBe(true);
  });

  it('should copy the original XML', fakeAsync(() => {
    const rawXml = '<Unit><Value>42</Value></Unit>';
    fixture.componentRef.setInput('xml', rawXml);
    fixture.detectChanges();

    expect(component.formattedXml).not.toBe(rawXml);

    component.copyToClipboard();

    expect(clipboard.copy).toHaveBeenCalledWith(rawXml);
    expect(component.copySucceeded).toBe(true);

    tick(1500);

    expect(component.copySucceeded).toBe(false);
  }));
});
