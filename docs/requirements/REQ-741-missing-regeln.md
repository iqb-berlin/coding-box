# REQ-741: Fachliche Missing-Regeln

## Grundmodell

Ein Missing-Profil enthält für jeden Eintrag einen negativen `code` und ein
explizites `score`-Property. Ein numerischer Score, einschließlich `0`, ist ein
regulärer Score. `score: null` ist ein valider fachlicher NA-Score. Ein fehlendes
`score`-Property ist dagegen eine unvollständige Konfiguration.

An der Exportgrenze wird ein fachlich klassifiziertes `score: null` als `NA`
ausgegeben. Eine leere Score-Zelle darf nicht als Ersatz für ein klassifiziertes
Missing verwendet werden.

## Status- und Designzuordnung

| Ursache | Missing-ID | IQB-Standard-Score |
| --- | --- | --- |
| `INVALID` | `mir` | `0` |
| `CODING_ERROR` | `mci` | `null` / `NA` |
| `UNSET`, `DISPLAYED`, `PARTLY_DISPLAYED` | `mbi_mbo` | `0` |
| `NOT_REACHED` | `mnr` | `null` / `NA` |
| Item laut Booklet-Design nicht vorgelegt | `mbd` | `null` / `NA` |

`DERIVE_PENDING` ist ein vorläufiger Prozesszustand und kein Missing. Im
kumulativen Ergebnisexport bleibt der Status sichtbar. In einer Item- oder
Score-Matrix muss der Zustand durch ein Ergebnis oder die Missing-Aggregation
aufgelöst werden; andernfalls schlägt der Export mit einer Diagnose fehl.

## Abgeleitete Variablen

Für fehlende Ergebnisse abgeleiteter Variablen werden die Zustände der
Quellvariablen paarweise aggregiert. `mci` dominiert. Danach gilt die Rangfolge
`valid > mir > mnr > mbi_mbo`. `mbd` darf nur mit `mbd` kombiniert werden;
`mbd` zusammen mit einem anderen Zustand ist ein Modellierungsfehler.

Wenn alle Quellen ein gültiges Ergebnis erwarten lassen, aber das abgeleitete
Ergebnis fehlt, ist die Zelle nicht als Missing klassifizierbar und der
Matrixexport schlägt fehl.

## Persistenz und Profilwahl

Autocoderläufe speichern Status, Code und Score profilneutral in `v1` bzw.
`v3`. Sie schreiben keine profilabhängigen Missing-Codes. Jeder kumulative
V1/V2/V3-Ergebnisexport und jeder Itemdatensatzexport verlangt ein ausdrücklich
gewähltes Missing-Profil.

V1- und V3-Statuswerte werden beim Export mit diesem Profil aufgelöst. Bereits
persistierte V2-Werte werden nicht auf ein anderes Profil umkodiert. Interne
manuelle Codes `-3` und `-4` werden als `mir` bzw. `mci` aufgelöst.

## Fehlerfälle

- Ein ausgewähltes Exportprofil muss `mir`, `mci`, `mbi_mbo`, `mnr` und `mbd`
  mit eindeutigen negativen Codes und expliziten Scores enthalten.
- Die technischen Codes `-1`, `-2`, `-3`, `-4` und `-111` sind nicht als
  Profilcodes zulässig.
- Ein Code ohne Score ist in einer Score-Matrix nicht exportierbar.
- Ein Score ohne Code ist in einer Code-Matrix nicht exportierbar.
- Eine erwartete, aber nicht fachlich klassifizierbare Matrixzelle führt zu
  einem fehlgeschlagenen Export mit begrenzten, nicht personenbezogenen
  Beispieldiagnosen.
- Es gibt keinen stillen Fallback auf `0` oder das IQB-Standardprofil.

## Bewusst unvollständiger Matrixexport

Der reguläre Matrixexport bleibt auch dann fehlgeschlagen, wenn intern bereits
eine Datei geschrieben wurde. Eine solche Datei darf nicht über den normalen
Download bereitgestellt werden.

Für diesen definierten Fehlerfall darf für höchstens eine Stunde ein gesondertes
ZIP-Paket bereitgehalten werden. Der Download erfordert eine ausdrückliche
Bestätigung und das Paket muss im Namen sowie in einer README als unvollständig
gekennzeichnet sein. Nicht auflösbare Zellen bleiben darin leer; sie werden
weder als `0` noch als `NA`, technischer Code oder Profil-Missing ausgegeben.

Das ZIP enthält neben der Matrix eine vollständige, nicht personenbezogene und
nach Ursache, Booklet und Spalte gruppierte `diagnose.csv`. Individuelle
Zeilennummern sind auf 20 Beispiele begrenzt. Abgelaufene oder verworfene
Artefakte werden gelöscht.
