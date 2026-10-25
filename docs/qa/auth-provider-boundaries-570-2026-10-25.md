# Providergrenzen #570: Dokumentations- und Testabgleich

Prüfdatum: 25.10.2026. Basis: aktuelles `origin/develop` bei
`edb09663f7b096128f4386bbd65c46888ad9ad70`, dem Merge von
[PR #1103](https://github.com/iqb-berlin/coding-box/pull/1103).
[#570](https://github.com/iqb-berlin/coding-box/issues/570) bleibt bis zur separaten
bestätigten Abnahme offen. Ein zusätzlicher realer Provider ist laut Ticketumfang
kein Abnahmekriterium.

## Abgleich mit den sechs Kriterien

| Kriterium | Dokumentation und technischer Nachweis |
| --- | --- |
| Aktive Keycloak-Annahmen auflisten | [DE-Handbuch](../oidc-authentication-de.md#konkreter-claim--und-providervertrag-570) und [EN-Handbuch](../oidc-authentication.md#concrete-claim-and-provider-contract-570) nennen `realm_access.roles`, den konkreten Adminnamen, die Quellen Userinfo/Access-Token und den Account-Redirect mit `referrer`/`referrer_uri`. Zusätzlich sind der Refresh-Token-Logout-POST und die verwendete Client-Authentifizierung beschrieben. |
| Bearer-Voraussetzungen | JWT/RS256, JWKS, exakter Issuer, passendes `azp` oder `aud`, nichtleeres `sub`, Username-Fallback im Bearer-Pfad und benötigte Claims der anderen Verbraucher stehen ausdrücklich im Handbuch. Signierte HTTP-Regressionen prüfen den tatsächlichen Guard-/JWKS-Pfad. |
| Generische Konfiguration, Deployment und Hilfsdienste trennen | Die aktive Registrierung von `OidcAuthService`/`JwtStrategy` wird von den nicht registrierten `KeycloakAuthService`-/`KeycloakJwksService`-Dateien und den bewusst spezifischen Realm-/Client-/Theme-/Installationsdateien unterschieden. |
| Anpassungen für einen anderen Provider und Prüfgrenzen | Die Claim-Matrix unterscheidet Callback, Bearer und Frontend. Dokumentiert sind fehlender allgemeiner Claim-Mapper, Userinfo/Access-Token-Anforderungen, Client-Authentifizierung im Formularbody, Logout-/Profilvertrag und lokale Benutzer-/Adminzuordnung. Ein isolierter Prüfablauf beschreibt den notwendigen Nachweis für eine konkrete weitere Anbindung. |
| Allgemeine Kompatibilitätsversprechen begrenzen | Beide Handbücher benennen Keycloak als belegte Integration. Konfigurierbare Endpunkte und synthetische JWKS-Tests sind ausdrücklich kein Nachweis für jeden OIDC-Provider. Ein Austausch der Basis-URL allein genügt nicht. |
| Keycloak-Abläufe erhalten | Ausschließlich Dokumentation geändert. Die bestehenden Backend- und Frontend-Regressionen wurden erneut ausgeführt. Die bisherigen Live-Abnahmen bleiben auf ihren dokumentierten Umfang begrenzt; ein neuer vollständiger Browserlauf oder Providerwechsel wird nicht behauptet. |

## Ausgewertete aktive Pfade

- [Auth-Modul](../../apps/backend/src/app/auth/auth.module.ts) und
  [Callback-/Logout-/Profil-Controller](../../apps/backend/src/app/auth/auth.controller.ts).
- [OIDC-Dienst](../../apps/backend/src/app/auth/service/oidc-auth.service.ts) für
  Code-Austausch, Userinfo, Refresh, PKCE/Exchange, Logout und Account-Redirect.
- [JWT-Strategie](../../apps/backend/src/app/auth/jwt.strategy.ts) für den Bearer-Pfad.
- [Frontend-AuthService](../../apps/frontend/src/app/core/services/auth.service.ts)
  für Access-Token-Profil, Rollen, Login und lokale Wiederherstellung.
- [Benutzersynchronisierung](../../apps/backend/src/app/database/services/users/users.service.ts)
  für Issuer/Subject, Benutzernamen-Fallback und erhaltene lokale Adminrechte.

Die Herkunft der Rollen und die lokale Speicherung sind verschiedene Schritte:
Ein fehlender Admin-Claim nimmt ein bereits gesetztes lokales `isAdmin` nicht
automatisch zurück. Der vorhandene Regressionstest zur erhaltenen Adminrolle ist
Teil der unten erneut ausgeführten Benutzerservice-Suite. Diese Dokumentation
ändert keine Rolle und keine bestehende Identitätszuordnung.

## Erneut ausgeführte Prüfungen

Frontend und Backend wurden einzeln und nacheinander geprüft:

```sh
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend --runInBand --testPathPatterns='(auth.controller|auth-jwks.integration|jwt.strategy|service/oidc-auth.service|oauth2-client-credentials).spec.ts$' --skipNxCache --cache=false
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test frontend --runInBand --testPathPatterns='core/services/auth.service.spec.ts$' --skipNxCache --cache=false
NX_DAEMON=false NX_NO_CLOUD=true npx --no-install nx test backend --runInBand --testPathPatterns='database/services/users/users.service.spec.ts$' --skipNxCache --cache=false
```

| Prüfung | Ergebnis |
| --- | --- |
| Auth-Backend | 4 Suites / 79 Tests bestanden: Controller, signierter JWKS-HTTP-Pfad, JWT-Strategie und OIDC-Dienst. Der Filter findet keine separate Client-Credentials-Suite; dafür wird kein zusätzlicher Testnachweis behauptet. |
| Benutzerservice | 1 Suite / 27 Tests bestanden, einschließlich bestehender lokaler Zuordnungen und erhaltener Adminrechte. |
| Frontend-AuthService | 1 Suite / 36 Tests bestanden. |
| Dokumentation | Relative Links und verwendete Abschnittsanker geprüft; DE-/EN-Env-Beispiele unverändert identisch. Die bereits abgenommenen F06-Abschnitte sind bytegleich erhalten. |

Die neu beschriebenen Details des Logout-POSTs, der erlaubten Client-
Authentifizierung und der Claim-Quellen wurden gegen die aktiven Implementierungen
abgeglichen. Die vorhandenen Tests bilden diese Protokollgrenzen nicht vollständig
als eigenständige Fälle ab. Die Ergänzung behauptet keine zusätzliche Live-Abnahme
dieser Einzelheiten oder eines weiteren Providers.

## Abnahme und Betriebsgrenzen

Die bestehenden [Neuinstallations-](https://github.com/iqb-berlin/coding-box/issues/564#issuecomment-6389951706),
[Upgrade-/Restore-](auth-upgrade-565-2026-10-25.md) und
[Sitzungs-/Recovery-Nachweise](auth-acceptance-2026-10-23.md) gelten weiterhin nur
für ihre dokumentierten Keycloak-Umgebungen und Prüfgrenzen.

Die Ergänzung konfiguriert keinen Provider, führt keine Migration aus und ändert
keine Daten, Konten, Berechtigungen, Sicherungen oder Laufzeitdateien. Sie ist eine
Konkretisierung des vorhandenen Vertrags. Remote-CI und eine bestätigte fachliche
Abnahme bleiben gesondert nachzuweisen. #570 wird durch Dokumentation, Commit,
PR oder Merge nicht automatisch geschlossen.
