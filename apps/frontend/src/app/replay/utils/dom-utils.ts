/**
 * Utility functions for DOM manipulation in the replay module
 */

/**
 * Highlights the direct child div elements of aspect-section tags that contain an element with the specified anchor.
 * If an anchor is provided, finds aspect-section tags that contain the element with that data-element-alias
 * and highlights their direct child div elements with a blue border.
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
      Array.from(allAspectSections).forEach(element => {
        const directChildDivs = element.querySelectorAll(':scope > div');
        directChildDivs.forEach(div => {
          (div as HTMLElement).style.border = '';
        });
      });

      let filteredElements: Element[] = Array.from(allAspectSections);

      // If anchor is provided, filter aspect-section tags that contain the element with the specified anchor
      if (anchor) {
        const elements = findElementsByDataAlias(iframe);
        const anchorElement = elements[anchor];

        if (anchorElement) {
          // Filter aspect-section tags that contain the anchor element
          filteredElements = Array.from(allAspectSections).filter(aspectSection => aspectSection.contains(anchorElement));

          // Visually highlight the direct child div elements of filtered aspect-section tags
          filteredElements.forEach(element => {
            const directChildDivs = element.querySelectorAll(':scope > div');
            directChildDivs.forEach(div => {
              (div as HTMLElement).style.border = '3px solid #4285f4'; // Google blue color
            });
          });
        }
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
      // Query for all div elements with data-element-alias attribute
      const elements = iframe.contentDocument.querySelectorAll('div[data-element-alias]');

      // Create a mapping of aliases to elements
      elements.forEach((element: Element) => {
        const alias = element.getAttribute('data-element-alias');
        if (alias) {
          result[alias] = element as HTMLElement;
        }
      });
    }
  } catch (error) {
    console.error('Error searching for elements with data-element-alias:', error);
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
    console.error(`Error scrolling to element with alias "${alias}":`, error);
  }

  return false;
}
