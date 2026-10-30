# Backend export and request boundaries

This change builds on `develop` at
`643e544a59b18af9ccc31f4e8c39f8295cdeb910`. It retains Nest 11 and the existing
package manifest and lockfile.

## Export ownership

`CodingExportService` retains its 22 public methods as a compatibility facade.
The existing `CodingModule` registers the implementation providers below; callers
still inject the facade. There are no new modules or runtime service locators.

| Provider | Responsibility |
| --- | --- |
| `CodingExportDownloadService` | Coding-list HTTP downloads, queue streams/files and versioned-export delegation |
| `CodingAggregatedExportService` | Most-frequent aggregation and selection of the aggregation layout |
| `CodingAggregatedRowsExportService` | Aggregation with one row per variable |
| `CodingAggregatedColumnsExportService` | Aggregation with one column per coder |
| `CodingCoderExportService` | Exports grouped by coder |
| `CodingVariableExportService` | Worksheet estimates and exports grouped by variable |
| `CodingCompactExportService` | Compact variable CSV streaming and row assembly |
| `CodingDetailedExportService` | Detailed coding-result CSV and file output |
| `CodingTimingReportExportService` | Coding-time reports and file output |
| `CodingExportQueryService` | Shared workspace exclusions, manual-variable selection, discussion results and job/coder scope filters |
| `CodingExportFormattingService` | Shared missing-profile resolution, score/code display and coding-issue labels |
| `CodingExportReplayService` | Shared page/anchor lookup and replay URLs |

Each export owner keeps its workflow's query, streaming and cancellation order
together. Stateless workbook, timing and SQL-fragment helpers live in
`coding-export.util.ts`; shared implementation types live in
`coding-export.types.ts`. Existing specialized exporters used by the orchestrator
retain their separate behavior and registrations.

The replay and missing-value caches remain shared singleton instances. The real
AppModule composition test checks facade ownership and those shared dependencies;
the existing dependency test checks that the provider graph remains acyclic.
Legacy behavioral fixtures construct the owners through an explicitly test-only
factory, excluded from the production TypeScript configuration. Production uses
ordinary constructor injection.

All 70 extracted method bodies, including SQL and template/string literals, were
compared with the immutable base using TypeScript syntax tokens. Only explicit
owner qualification, comments and formatting were normalized. All 22 public
signatures and delegate argument lists were also compared. Existing golden-output,
stream/file, filtering, missing-code and cancellation fixtures remain in place.

### Detailed CSV file ownership

After the extraction, detailed CSV output was hardened separately. File output
creates a new file exclusively (`wx`) with mode `0600` and retains one open file
handle for the header, batches and final training-discussion row. Existing files
and symlinks are rejected without modifying their contents. Later batches never
reopen the destination pathname. The handle is closed on success, cancellation
and errors. Buffer output and CSV bytes remain unchanged.

The private working directory alone does not protect the published file:
`ExportArtifactService` moves it into the shared export directory. File ownership
and mode must therefore remain restrictive after that rename. Worker and API use
the same backend image and OS user; the guarded API streams the completed file.

CodeQL alerts [149](https://github.com/iqb-berlin/coding-box/security/code-scanning/149)
and [150](https://github.com/iqb-berlin/coding-box/security/code-scanning/150)
identify intended CSV persistence, rather than an arbitrary upload destination.
The file-output caller constructs a server-generated pathname in a fresh private
working directory. Request fields are export options or CSV contents; they do not
select the filesystem destination. The synchronous HTTP export returns a buffer.
This does not establish a remote arbitrary-path exploit. Alert
[148](https://github.com/iqb-berlin/coding-box/security/code-scanning/148)
does identify missing file-level protection: default permissions can expose the
published CSV to other OS users with directory access under a permissive umask.
No live deployment permissions or ACLs were assumed or measured.

## Testcenter requests

All six outgoing Testcenter request sites use the existing 120,000 ms Axios
timeout: authentication, group discovery, response chunks, logs, file discovery
and individual file downloads. TLS verification and the existing error/progress
handling remain intact. A stalled-request fixture advances the configured timeout
and verifies failed progress without proceeding to workspace-group processing.

## Boolean query contracts

The updated named Boolean queries use Nest's `ParseBoolPipe`. Optional values retain the
distinction between omitted, `true` and `false`. The versioned exporters use
`DefaultValuePipe`: response values default to `true`; replay URLs, GeoGebra
response values and GeoGebra file packages default to `false`.

The accepted wire values are `true` and `false`. Empty, numeric, uppercase,
malformed and repeated values return HTTP 400 before application services run.
The previous permissive string comparisons no longer silently interpret those
values as a disabled flag. Valid client URLs and shared DTOs are unchanged.

The HTTP regression table lists the expected public contracts independently of
the installed parameter pipes: 69 route/flag combinations across 33 route entries,
including the training-reliability alias. Additional HTTP cases exercise explicit
`false`, the versioned-export defaults and the three-way training filter.
