export const RESPONSE_STATUS_INFO: Record<
  string,
  { numeric: number; descriptionKey: string }
> = {
  UNSET: {
    numeric: 0,
    descriptionKey:
      'response-status.descriptions.UNSET'
  },
  NOT_REACHED: {
    numeric: 1,
    descriptionKey:
      'response-status.descriptions.NOT_REACHED'
  },
  DISPLAYED: {
    numeric: 2,
    descriptionKey:
      'response-status.descriptions.DISPLAYED'
  },
  VALUE_CHANGED: {
    numeric: 3,
    descriptionKey:
      'response-status.descriptions.VALUE_CHANGED'
  },
  CODING_COMPLETE: {
    numeric: 5,
    descriptionKey: 'response-status.descriptions.CODING_COMPLETE'
  },
  NO_CODING: {
    numeric: 6,
    descriptionKey:
      'response-status.descriptions.NO_CODING'
  },
  INVALID: {
    numeric: 7,
    descriptionKey:
      'response-status.descriptions.INVALID'
  },
  CODING_INCOMPLETE: {
    numeric: 8,
    descriptionKey:
      'response-status.descriptions.CODING_INCOMPLETE'
  },
  CODING_ERROR: {
    numeric: 9,
    descriptionKey:
      'response-status.descriptions.CODING_ERROR'
  },
  PARTLY_DISPLAYED: {
    numeric: 10,
    descriptionKey:
      'response-status.descriptions.PARTLY_DISPLAYED'
  },
  DERIVE_PENDING: {
    numeric: 11,
    descriptionKey:
      'response-status.descriptions.DERIVE_PENDING'
  },
  INTENDED_INCOMPLETE: {
    numeric: 12,
    descriptionKey:
      'response-status.descriptions.INTENDED_INCOMPLETE'
  },
  CODE_SELECTION_PENDING: { numeric: 13, descriptionKey: '' }
};
