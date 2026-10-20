export const RESPONSE_STATUS_INFO: Record<
  string,
  { numeric: number; description: string }
> = {
  UNSET: {
    numeric: 0,
    description:
      'Ausgangszustand beim Anlegen von Variablen. Sollte eine Variable an ein Interaktionselement gebunden sein, dann erhält sie jedoch sofort den Status NOT_REACHED.'
  },
  NOT_REACHED: {
    numeric: 1,
    description:
      'Ausgangszustand beim Anlegen von Variablen, die an ein Interaktionselement gebunden sind.'
  },
  DISPLAYED: {
    numeric: 2,
    description:
      'Variablen, die an ein Interaktionselement gebunden sind, bekommen diesen Status, wenn sie der Testperson präsentiert wurden - also sichtbar sind.'
  },
  VALUE_CHANGED: {
    numeric: 3,
    description:
      'Dieser Status zeigt an, dass eine Interaktion stattgefunden hat und also der Wert (Value) auszuwerten ist. Bei abgeleiteten Variablen zeigt dieser Status eine erfolgreiche Ableitung an.'
  },
  CODING_COMPLETE: {
    numeric: 5,
    description: 'Die Kodierung der Variablen ist erfolgreich abgeschlossen.'
  },
  NO_CODING: {
    numeric: 6,
    description:
      'Bei diesem Status wurde festgestellt, dass keine Informationen für eine Kodierung vorliegen (keine Codes sind im Kodierschema definiert). Das stellt eine Fehlersituation dar.'
  },
  INVALID: {
    numeric: 7,
    description:
      'Es wurde bei diesem Status eine Antwort festgestellt, die außerhalb des zulässigen Bereiches liegt. Beispielsweise wurde zwar zunächst ein Text eingegeben, dann aber alles gelöscht, so dass eine leere Antwort gespeichert wurde. Mit diesem Code werden auch Spaßantworten “Mir ist langweilig” kodiert.'
  },
  CODING_INCOMPLETE: {
    numeric: 8,
    description:
      'Dieser Code zeigt nach einem Durchlauf einer Kodierprozedur an, dass keiner der vorgesehenen Codes als zutreffend angesehen wurde. Dieser Kodierfall muss dann manuell gesichtet werden.'
  },
  CODING_ERROR: {
    numeric: 9,
    description:
      'Während der Kodierung ist ein Fehler aufgetreten, der die Bewertung der Antwort verhindert hat. Dies kann ein technischer Fehler bei der Anzeige (Replay) für das manuelle Kodieren sein, aber auch Typkonflikte zwischen dem Wert und dem Kodierschema können die Ursache sein.'
  },
  PARTLY_DISPLAYED: {
    numeric: 10,
    description:
      'Diesen Zustand erhalten abgeleitete Variablen, die von Variablen abgeleitet wurden mit dem Status PARTLY_DISPLAYED oder mit DISPLAYED sowie außerdem den Status NOT_REACHED oder UNSET.'
  },
  DERIVE_PENDING: {
    numeric: 11,
    description:
      'Dieser Status zeigt an, dass eine Ableitung nicht möglich ist, weil mindestens eine Variable, die zur Ableitung nötig ist, den Status CODING_INCOMPLETE oder CODING_ERROR hat. Im Arbeitsablauf “wartet” diese Variable also darauf, dass eine manuelle Kodierung zu CODING_COMPLETE führt und der Autocoder neu angestoßen wird.'
  },
  INTENDED_INCOMPLETE: {
    numeric: 12,
    description:
      'Die Kodierung der Variablen ist nicht abgeschlossen, aber dies stellt keinen Fehler dar. Es handelt sich hier z. B. um Variablen, die über andere Wege kodiert werden sollen (z. B. Rating oder Übersetzung in Berufe-Codes außerhalb der regulären Kodierprozesse). Es kann auch sein, dass der Variablenwert erst durch eine Ableitung ausgewertet wird und innerhalb der Variable keine isolierte Bewertung möglich ist.'
  },
  CODE_SELECTION_PENDING: { numeric: 13, description: '' }
};
