# Vector print modification (other cli class definitions go here)
cli_setting <- function(.envir = parent.frame()) {
  cli::start_app(
    .auto_close = TRUE,
    .envir = .envir,
    theme = list(
      "body" = list("vec-trunc" = Inf),
      # User of instances
      ".user-label" = list("color" = "#a855f7"),
      ".user-name" = list("color" = "#d8b4fe"),
      # Workspace group (Studio)
      ".wsg-id" = list("color" = "#bef264"),
      ".wsg-label" = list("color" = "#84cc16"),
      # Workspace
      ".ws-id" = list("color" = "#89b3ff"),
      ".ws-label" = list("color" = "#5793FF"),
      # Unit
      ".unit-id" = list("color" = "#f87171"),
      ".unit-key" = list("color" = "#E83938"),
      ".unit-label" = list("color" = "#fca5a5"),
      # Booklet
      ".booklet-id" = list("color" = "#bef264"),
      ".booklet-label" = list("color" = "#8BE836"),
      # Testtaker
      ".testtaker-id" = list("color" = "#fde047"),
      ".testtaker-label" = list("color" = "#FFC142"),
      # Profiles
      ".profile-id" = list("color" = "#e2e8f0"),
      ".profile-label" = list("color" = "#cbd5e1")
    )
  )
}
