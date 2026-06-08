import { highlightAspectSectionWithAnchor, scrollToElementByAlias } from './dom-utils';

describe('replay dom-utils', () => {
  function createIframe(html: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    const iframeDocument = iframe.contentDocument;
    if (!iframeDocument) {
      throw new Error('iframe document not available');
    }

    iframeDocument.open();
    iframeDocument.write(html);
    iframeDocument.close();

    return iframe;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns no highlighted sections when an anchor is not in the player DOM', () => {
    const iframe = createIframe(`
      <aspect-section>
        <div id="section-frame">
          <span data-element-alias="VAR1"></span>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, 'UNKNOWN');
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;

    expect(highlighted).toEqual([]);
    expect(sectionFrame.style.border).toBe('');
  });

  it('highlights the containing section for a regular aliased element', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <span data-element-alias="VAR1"></span>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, 'VAR1');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('3px solid #4285f4');
  });

  it('highlights only the requested field in a multi-field cloze', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-cloze data-element-alias="cloze_1">
            <span id="field-a" data-element-alias="01a"></span>
            <span id="field-b" data-element-alias="01b"></span>
          </aspect-cloze>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01b');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const fieldA = iframe.contentDocument?.querySelector('#field-a') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(fieldA.style.border).toBe('');
    expect(fieldB.style.border).toBe('3px solid #4285f4');
  });

  it('falls back to section highlighting for a single-field cloze', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-cloze data-element-alias="cloze_1">
            <span id="field-a" data-element-alias="01a"></span>
          </aspect-cloze>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01a');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const fieldA = iframe.contentDocument?.querySelector('#field-a') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('3px solid #4285f4');
    expect(fieldA.style.border).toBe('');
  });

  it('highlights only the requested table cell when table fields share a section', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-table id="table" role="grid">
            <div id="cell-a" role="gridcell">
              <span id="field-a" data-element-alias="01a"></span>
            </div>
            <div id="cell-b" role="gridcell">
              <span id="field-b" data-element-alias="01b"></span>
            </div>
          </aspect-table>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01b');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const cellA = iframe.contentDocument?.querySelector('#cell-a') as HTMLElement;
    const cellB = iframe.contentDocument?.querySelector('#cell-b') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(cellA.style.outline).toBe('');
    expect(cellB.style.outline).toBe('3px solid #4285f4');
    expect(cellB.style.outlineOffset).toBe('-3px');
    expect(fieldB.style.border).toBe('');
  });

  it('highlights an aliased table field when no separate cell wrapper exists', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-table id="table" role="grid">
            <span id="field-a" data-element-alias="01a" style="grid-row: 2; grid-column: 2"></span>
            <span id="field-b" data-element-alias="01b" style="grid-row: 2; grid-column: 3"></span>
          </aspect-table>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01a');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const fieldA = iframe.contentDocument?.querySelector('#field-a') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(fieldA.style.outline).toBe('3px solid #4285f4');
    expect(fieldA.style.outlineOffset).toBe('-3px');
    expect(fieldB.style.outline).toBe('');
  });

  it('highlights the real player table cell container for table text fields', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-table>
            <div class="grid-container" style="display: grid">
              <div id="cell-a" class="cell-container" style="grid-row-start: 2; grid-column-start: 4;">
                <div class="element-container">
                  <aspect-table-child-overlay>
                    <div class="wrapper">
                      <aspect-text-field id="field-a" data-element-alias="01"></aspect-text-field>
                    </div>
                  </aspect-table-child-overlay>
                </div>
              </div>
              <div id="cell-b" class="cell-container" style="grid-row-start: 3; grid-column-start: 3;">
                <div class="element-container">
                  <aspect-table-child-overlay>
                    <div class="wrapper">
                      <aspect-text-field id="field-b" data-element-alias="02"></aspect-text-field>
                    </div>
                  </aspect-table-child-overlay>
                </div>
              </div>
            </div>
          </aspect-table>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '02');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const cellA = iframe.contentDocument?.querySelector('#cell-a') as HTMLElement;
    const cellB = iframe.contentDocument?.querySelector('#cell-b') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(cellA.style.outline).toBe('');
    expect(cellB.style.outline).toBe('3px solid #4285f4');
    expect(fieldB.style.outline).toBe('');
  });

  it('highlights a standalone text field instead of the whole section grid', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <div id="table-frame"></div>
          <span data-element-alias="text_1">Kirschsaft</span>
          <aspect-text-field id="field-a" data-element-alias="01a"></aspect-text-field>
          <aspect-text-field id="field-b" data-element-alias="01b"></aspect-text-field>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01a');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const fieldA = iframe.contentDocument?.querySelector('#field-a') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(fieldA.style.outline).toBe('');
    expect(fieldA.style.boxShadow).toBe('inset 0 0 0 2px #4285f4');
    expect(fieldB.style.boxShadow).toBe('');
  });

  it('highlights a text field inside an aliased element wrapper', () => {
    const iframe = createIframe(`
      <aspect-section id="section">
        <div id="section-frame">
          <aspect-element data-element-alias="01a">
            <aspect-text-field id="field-a">
              <div id="material-wrapper-a" class="mat-mdc-text-field-wrapper mdc-text-field">
                <div id="material-outline-a" class="mdc-notched-outline"></div>
                <input id="native-input-a">
              </div>
            </aspect-text-field>
          </aspect-element>
          <aspect-element data-element-alias="01b">
            <aspect-text-field id="field-b">
              <div id="material-wrapper-b" class="mat-mdc-text-field-wrapper mdc-text-field">
                <div id="material-outline-b" class="mdc-notched-outline"></div>
                <input id="native-input-b">
              </div>
            </aspect-text-field>
          </aspect-element>
        </div>
      </aspect-section>
    `);

    const highlighted = highlightAspectSectionWithAnchor(iframe, '01a');
    const section = iframe.contentDocument?.querySelector('#section') as HTMLElement;
    const sectionFrame = iframe.contentDocument?.querySelector('#section-frame') as HTMLElement;
    const fieldA = iframe.contentDocument?.querySelector('#field-a') as HTMLElement;
    const inputA = iframe.contentDocument?.querySelector('#native-input-a') as HTMLElement;
    const materialWrapperA = iframe.contentDocument?.querySelector('#material-wrapper-a') as HTMLElement;
    const materialOutlineA = iframe.contentDocument?.querySelector('#material-outline-a') as HTMLElement;
    const materialOutlineB = iframe.contentDocument?.querySelector('#material-outline-b') as HTMLElement;
    const materialWrapperB = iframe.contentDocument?.querySelector('#material-wrapper-b') as HTMLElement;
    const fieldB = iframe.contentDocument?.querySelector('#field-b') as HTMLElement;

    expect(highlighted).toEqual([section]);
    expect(sectionFrame.style.border).toBe('');
    expect(fieldA.style.outline).toBe('');
    expect(inputA.style.boxShadow).toBe('');
    expect(materialWrapperA.style.boxShadow).toBe('');
    expect(materialOutlineA.style.boxShadow).toBe('inset 0 0 0 2px #4285f4');
    expect(materialOutlineB.style.boxShadow).toBe('');
    expect(materialWrapperB.style.boxShadow).toBe('');
    expect(fieldB.style.outline).toBe('');
  });

  it('scrolls to an element by alias when it exists', () => {
    const iframe = createIframe('<span id="target" data-element-alias="VAR1"></span>');
    const target = iframe.contentDocument?.querySelector('#target') as HTMLElement;
    target.scrollIntoView = jest.fn();

    const scrolled = scrollToElementByAlias(iframe, 'VAR1');

    expect(scrolled).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  });
});
