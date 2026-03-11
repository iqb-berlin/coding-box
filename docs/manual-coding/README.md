# Manuelle Kodierung

Dieses Dokument beschreibt den Ablauf und die Auswahllogik bei der manuellen Kodierung
in Kodierbox, insbesondere bei der Erstellung von Kodierer-Schulungen.

## Überblick

Eine Kodierer-Schulung erstellt pro ausgewahltem Kodierer einen Kodierjob mit einer
konsistenten Fallstichprobe. Alle Kodierer erhalten dabei dieselben Falle (pro
Variable/Unit-Konfiguration).

## Schulung erstellen

Der Prozess besteht aus mehreren Schritten. Die Reihenfolge ist im UI vorgegeben,
aber inhaltlich wichtig ist, dass Variablen/Bundle-Auswahl und Stichprobenumfang
vor dem Erstellen der Schulung konsistent sind.

### 1) Schulungsbezeichnung

* Vergib eine eindeutige Bezeichnung.
* Der Name wird als Job-Prafix genutzt (z. B. `Schulung-<label>-<coder>`).

### 2) Kodierer auswahlen

* Wahlen Sie alle Kodierer aus, die den gleichen Fallsatz erhalten sollen.
* Alle Kodierer bekommen identische Stichproben pro Variable/Unit-Konfiguration.

### 3) Variablen und Variablenbundel

Es gibt zwei Wege, Variablen in die Schulung aufzunehmen:

* **Manuelle Variablen**: Auswahl einzelner Variablen/Units mit individuellem Stichprobenumfang.
* **Variablenbundel**: Eine Sammlung von Variablen mit gemeinsamem Stichprobenumfang
  (pro Variable im Bundel).

Hinweis:
* Bundel-Variablen werden als Gruppe behandelt und konnen eine eigene Fallanordnung haben.
* Manuell gewahlte Variablen sollten nicht gleichzeitig in Bundeln enthalten sein,
  um Doppelungen zu vermeiden.

### 4) Stichprobenumfang pro Variable

* Pro Variable wird ein Stichprobenumfang `n` festgelegt.
* Falls weniger als `n` verfugbare Falle existieren, werden entsprechend weniger Falle genommen.

### 5) Fallauswahl-Strategie

Legt fest, **welche** Falle aus den verfugbaren Responses ausgewahlt werden (siehe unten).

### 6) Referenz-Schulungen (optional)

Optional konnen bestehende Schulungen als Referenz gewahlt werden:

* `same`: Nur Falle, die in der/den Referenz-Schulung(en) enthalten sind.
* `different`: Nur Falle, die nicht in der/den Referenz-Schulung(en) enthalten sind.

Die Referenz wirkt pro Variable/Unit-Konfiguration und filtert vor der finalen Auswahl.

### 7) Schulung erstellen

Beim Erstellen passiert serverseitig Folgendes:

1. Alle geeigneten Responses werden je Variable/Unit geladen.
2. Identische Responses pro Person/Unit/Variable/Antwortinhalt werden dedupliziert.
3. Optional: Referenz-Filter wird angewendet (`same` / `different`).
4. Optional: Aggregations-Logik reduziert Responses pro Wertgruppe (falls aktiviert).
5. Fallauswahl-Strategie wird angewendet und `n` Responses werden gesampelt.
6. Die so gesampelten Responses werden **fur alle Kodierer identisch** in Jobs gespeichert.

Ergebnis: Pro Kodierer entsteht ein Kodierjob mit der gleichen Fallstichprobe.

## Fallauswahl-Strategien

Die Fallauswahl erfolgt pro Variable/Unit-Konfiguration.

* `oldest_first`: Alteste Falle zuerst. Sortiert nach `chunk.ts` (Fallback: `response.id`)
  und nimmt die ersten `n` Falle.
* `newest_first`: Neueste Falle zuerst. Sortiert nach `chunk.ts` (Fallback: `response.id`)
  und nimmt die letzten `n` Falle.
* `random`: Zufallige Auswahl von `n` Fallen, alle gleich wahrscheinlich.
* `random_per_testgroup`: Zufallige Auswahl von `n` Fallen, moglichst gleichmaig
  uber alle Testgruppen verteilt.
* `random_testgroups`: Testgruppen werden zufallig sortiert; aus jeder Gruppe werden
  Falle genommen, bis insgesamt `n` Falle erreicht sind.

Hinweis: Falls mehrere `chunk.ts`-Werte fur dieselbe Unit/Variable vorhanden sind,
wird fur `oldest_first` der kleinste und fur `newest_first` der groste Zeitstempel verwendet.

## Referenz-Schulungen (optional)

Mit Referenz-Schulungen kann die Auswahl eingeschrankt werden:

* `same`: Nur Falle, die bereits in der/den gewahlten Schulung(en) enthalten sind.
* `different`: Nur Falle, die in der/den gewahlten Schulung(en) nicht enthalten sind.

## Fallanordnung im Job

Die Fallanordnung steuert nur die Reihenfolge in der Kodierliste:

* `continuous`: Alle Falle einer Variable zusammen.
* `alternating`: Alle Variablen eines Falls zusammen, dann der nachste Fall.

## Deduplizierung identischer Falle

Bei neuen Schulungen werden identische Falle pro Person/Unit/Variable/Antwortinhalt
dedupliziert (es bleibt die Response mit der kleinsten `response.id`). Bestehende
Kodierjobs bleiben unverandert.

## Hinweise zur Aktualisierung einer Schulung

Beim Bearbeiten einer Schulung konnen Jobs neu erzeugt werden, wenn sich die
Konfiguration andert (z. B. andere Kodierer, Variablen oder Bundel). In diesem Fall
wird die Fallauswahl mit den aktuellen Regeln erneut durchgefuhrt.

Wenn sich nur Metadaten (z. B. Label) andern, bleiben die bestehenden Jobs unverandert.
