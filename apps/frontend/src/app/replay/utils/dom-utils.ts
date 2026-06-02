/**
 * Utility functions for DOM manipulation in the replay module
 */

const HIGHLIGHT_BORDER = '3px solid #4285f4';
const HIGHLIGHT_ATTR = 'data-coding-box-anchor-highlight';

function clearHighlight(element: HTMLElement): void {
  element.style.border = '';
  element.style.outline = '';
  element.style.outlineOffset = '';
  element.removeAttribute(HIGHLIGHT_ATTR);
}

function highlightWithBorder(element: HTMLElement): void {
  element.style.border = HIGHLIGHT_BORDER;
  element.setAttribute(HIGHLIGHT_ATTR, 'true');
}

function highlightWithOutline(element: HTMLElement): void {
  element.style.outline = HIGHLIGHT_BORDER;
  element.style.outlineOffset = '-3px';
  element.setAttribute(HIGHLIGHT_ATTR, 'true');
}

function getParentSection(element: HTMLElement): HTMLElement | null {
  return element.closest('aspect-section') as HTMLElement | null;
}

function getTableHighlightTarget(anchorElement: HTMLElement): HTMLElement | null {
  const tableElement = anchorElement.closest(
    'aspect-table, table, [data-element-type="table"], [data-aspect-type="table"]'
  );

  if (!tableElement) {
    return null;
  }

  const explicitCell = anchorElement.closest(
    'td, th, [role="cell"], [role="gridcell"], aspect-table-cell, [data-table-cell], .cell-container, .table-cell, .cell'
  );

  if (explicitCell && tableElement.contains(explicitCell)) {
    return explicitCell as HTMLElement;
  }

  let current: HTMLElement | null = anchorElement;
  const view = anchorElement.ownerDocument.defaultView;
  while (current && current !== tableElement) {
    const inlineStyle = current.getAttribute('style') || '';
    const computedStyle = view?.getComputedStyle(current);
    const hasGridPlacement =
      inlineStyle.includes('grid-row') ||
      inlineStyle.includes('grid-column') ||
      (!!computedStyle &&
        computedStyle.gridRowStart !== 'auto' &&
        computedStyle.gridColumnStart !== 'auto');

    if (hasGridPlacement) {
      return current;
    }

    if (current.parentElement === tableElement) {
      return current;
    }

    current = current.parentElement;
  }

  return anchorElement;
}

/**
 * Highlights the direct child div elements of aspect-section tags that contain an element with the specified anchor.
 * If an anchor is provided, finds aspect-section tags that contain the element with that data-element-alias
 * and highlights their direct child div elements with a blue border. Multi-field cloze and table elements
 * are highlighted directly instead, using a border or outline on the focused field or cell.
 *
 * @param iframe The iframe element containing the player's HTML
 * @param anchor Optional data-element-alias to filter aspect-section tags
 * @returns An array of the found aspect-section elements
 */
export function highlightAspectSectionWithAnchor(iframe: HTMLIFrameElement, anchor?: string): HTMLElement[] {
  const result: HTMLElement[] = [];

  try {
    if (iframe.contentDocument) {
      const allAspectSections = iframe.contentDocument.querySelectorAll('aspect-section');
      const elementsByAlias = findElementsByDataAlias(iframe);

      iframe.contentDocument.querySelectorAll(`[${HIGHLIGHT_ATTR}="true"]`).forEach(el => {
        clearHighlight(el as HTMLElement);
      });

      // Reset borders on all potential highlight targets to clear previous state.
      // 1. Reset all elements with aliases (handles individual highlights like cloze fields).
      Object.values(elementsByAlias).forEach(el => {
        clearHighlight(el);
      });

      // 2. Reset direct child divs of all aspect-sections (handles standard section highlighting).
      Array.from(allAspectSections).forEach(section => {
        const directChildDivs = section.querySelectorAll(':scope > div');
        directChildDivs.forEach(div => {
          clearHighlight(div as HTMLElement);
        });
      });

      let filteredElements: Element[] = Array.from(allAspectSections);

      // If anchor is provided, filter aspect-section tags that contain the element with the specified anchor
      if (anchor) {
        const anchorElement = elementsByAlias[anchor];

        if (!anchorElement) {
          return result;
        }

        const tableHighlightTarget = getTableHighlightTarget(anchorElement);
        if (tableHighlightTarget) {
          highlightWithOutline(tableHighlightTarget);
          const parentSection = getParentSection(anchorElement);
          if (parentSection) {
            result.push(parentSection);
          }
          return result;
        }

        // If the element is part of a cloze with multiple fields, only highlight the field itself.
        const clozeElement = anchorElement.closest('aspect-cloze');
        if (clozeElement) {
          const aliasedInside = clozeElement.querySelectorAll('[data-element-alias]');
          // Exclude the cloze itself if it has an alias
          const variablesInside = Array.from(aliasedInside).filter(el => el !== clozeElement);
          if (variablesInside.length > 1) {
            highlightWithBorder(anchorElement);
            // Find containing aspect-section to include it in the return value
            const parentSection = getParentSection(anchorElement);
            if (parentSection) {
              result.push(parentSection);
            }
            return result;
          }
        }

        // Filter aspect-section tags that contain the anchor element
        filteredElements = Array.from(allAspectSections).filter(aspectSection => aspectSection.contains(anchorElement));

        // Visually highlight the direct child div elements of filtered aspect-section tags
        filteredElements.forEach(element => {
          const directChildDivs = element.querySelectorAll(':scope > div');
          directChildDivs.forEach(div => {
            highlightWithBorder(div as HTMLElement);
          });
        });
      }

      filteredElements.forEach((element: Element) => {
        result.push(element as HTMLElement);
      });
    }
  } catch (error) {
    // Silently handle errors
  }

  return result;
}

/**
 * Searches for div elements with data-element-alias attribute in the player's HTML
 * and returns an object mapping the aliases to their corresponding elements.
 *
 * @param iframe The iframe element containing the player's HTML
 * @returns An object mapping data-element-alias values to their HTML elements
 */
export function findElementsByDataAlias(iframe: HTMLIFrameElement): Record<string, HTMLElement> {
  const result: Record<string, HTMLElement> = {};

  try {
    if (iframe.contentDocument) {
      // Query for all elements with data-element-alias attribute
      const elements = iframe.contentDocument.querySelectorAll('[data-element-alias]');

      // Create a mapping of aliases to elements
      elements.forEach((element: Element) => {
        const alias = element.getAttribute('data-element-alias');
        if (alias) {
          result[alias] = element as HTMLElement;
        }
      });
    }
  } catch (error) {
    // Error occurred while searching for elements with data-element-alias
  }

  return result;
}

export function scrollToElementByAlias(
  iframe: HTMLIFrameElement,
  alias: string,
  options?: ScrollIntoViewOptions
): boolean {
  try {
    const elements = findElementsByDataAlias(iframe);
    const element = elements[alias];
    if (element) {
      element.scrollIntoView(options || { behavior: 'smooth', block: 'center' });
      return true;
    }
  } catch (error) {
    // Error occurred while scrolling to element with the specified alias
  }

  return false;
}
