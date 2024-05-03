export const unitDef = {
  type: 'aspect-unit-definition',
  stateVariables: [],
  version: '4.4.0',
  pages: [{
    sections: [{
      elements: [{
        id: 'radio_1',
        isRelevantForPresentationComplete: true,
        dimensions: {
          width: 180, height: 100, isWidthFixed: false, isHeightFixed: false, minWidth: null, maxWidth: null, minHeight: null, maxHeight: null
        },
        position: {
          xPosition: 0, yPosition: 0, gridColumn: null, gridColumnRange: 1, gridRow: null, gridRowRange: 1, marginLeft: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginTop: { value: 0, unit: 'px' }, marginBottom: { value: 0, unit: 'px' }, zIndex: 0
        },
        styling: {
          backgroundColor: 'transparent', fontColor: '#000000', font: 'NunitoSans', fontSize: 20, bold: false, italic: false, underline: false, lineHeight: 135
        },
        label: 'Hier folgt eine Beispielaufgabe. Diese ist auf allen Seiten für die Darstellung erst einmal immer dieselbe.',
        value: null,
        required: false,
        requiredWarnMessage: 'Eingabe erforderlich',
        readOnly: false,
        type: 'radio',
        options: [{ text: '<span>Option 1</span>' }, { text: 'Option 2' }, { text: 'Option 3' }, { text: 'Option 4' }],
        alignment: 'column',
        strikeOtherOptions: false
      }],
      height: 400,
      backgroundColor: '#ffffff',
      dynamicPositioning: true,
      autoColumnSize: true,
      autoRowSize: true,
      gridColumnSizes: [{ value: 1, unit: 'fr' }, { value: 1, unit: 'fr' }],
      gridRowSizes: [{ value: 1, unit: 'fr' }],
      visibilityDelay: 0,
      animatedVisibility: false,
      enableReHide: false,
      logicalConnectiveOfRules: 'disjunction',
      visibilityRules: []
    }, {
      elements: [{
        id: 'text_2',
        isRelevantForPresentationComplete: true,
        dimensions: {
          width: 180, height: 98, isWidthFixed: false, isHeightFixed: false, minWidth: null, maxWidth: null, minHeight: null, maxHeight: null
        },
        position: {
          xPosition: 0, yPosition: 0, gridColumn: 1, gridColumnRange: 1, gridRow: 1, gridRowRange: 1, marginLeft: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginTop: { value: 16, unit: 'px' }, marginBottom: { value: 0, unit: 'px' }, zIndex: 0
        },
        styling: {
          backgroundColor: 'transparent', fontColor: '#000000', font: 'NunitoSans', fontSize: 20, bold: false, italic: false, underline: false, lineHeight: 135
        },
        type: 'text',
        text: '<p style="padding-left: 0px; text-indent: 0px; margin-bottom: 0px; margin-top: 0" indentsize="20"></p>',
        highlightableOrange: false,
        highlightableTurquoise: false,
        highlightableYellow: false,
        hasSelectionPopup: true,
        columnCount: 1
      }, {
        id: 'text_31',
        isRelevantForPresentationComplete: true,
        dimensions: {
          width: 165, height: 98, isWidthFixed: false, isHeightFixed: false, minWidth: 165, maxWidth: null, minHeight: null, maxHeight: null
        },
        position: {
          xPosition: 0, yPosition: 0, gridColumn: 2, gridColumnRange: 1, gridRow: 1, gridRowRange: 1, marginLeft: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginTop: { value: 16, unit: 'px' }, marginBottom: { value: 0, unAit: 'px' }, zIndex: 0
        },
        styling: {
          backgroundColor: 'transparent', lineHeight: 135, fontColor: '#000000', font: 'Roboto', fontSize: 20, bold: false, italic: false, underline: false
        },
        type: 'text',
        text: '<p style="padding-left: 0px; text-indent: 0px; margin-bottom: 0px; margin-top: 0" indent="0" indentsize="20"><span style="font-size: 20px">Hier geht’s weiter.</span></p>',
        highlightableOrange: false,
        highlightableTurquoise: false,
        highlightableYellow: false,
        hasSelectionPopup: true,
        columnCount: 1
      }, {
        id: 'button_2',
        isRelevantForPresentationComplete: true,
        dimensions: {
          width: 60, height: 60, isWidthFixed: true, isHeightFixed: true, minWidth: null, maxWidth: null, minHeight: null, maxHeight: null
        },
        position: {
          xPosition: 0, yPosition: 0, gridColumn: 3, gridColumnRange: 1, gridRow: 1, gridRowRange: 1, marginLeft: { value: 0, unit: 'px' }, marginRight: { value: 0, unit: 'px' }, marginTop: { value: 0, unit: 'px' }, marginBottom: { value: 0, unit: 'px' }, zIndex: 0
        },
        styling: {
          backgroundColor: '#d3d3d3', fontColor: '#000000', font: 'Roboto', fontSize: 20, bold: false, italic: false, underline: false, borderWidth: 0, borderColor: 'black', borderStyle: 'solid', borderRadius: 0
        },
        type: 'button',
        label: '',
        imageSrc: 'data:image/png;base64,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',
        asLink: false,
        action: 'unitNav',
        actionParam: 'next',
        tooltipText: '',
        tooltipPosition: 'below',
        labelAlignment: 'baseline'
      }],
      height: 400,
      backgroundColor: '#ffffff',
      dynamicPositioning: true,
      autoColumnSize: false,
      autoRowSize: true,
      gridColumnSizes: [{ value: '5.5', unit: 'fr' }, { value: '2', unit: 'fr' }, { value: '1', unit: 'fr' }],
      gridRowSizes: [{ value: '1', unit: 'fr' }],
      visibilityDelay: 0,
      animatedVisibility: false,
      enableReHide: false,
      logicalConnectiveOfRules: 'disjunction',
      visibilityRules: []
    }],
    hasMaxWidth: true,
    maxWidth: 750,
    margin: 30,
    backgroundColor: '#ffffff',
    alwaysVisible: false,
    alwaysVisiblePagePosition: 'left',
    alwaysVisibleAspectRatio: 50
  }]
};
