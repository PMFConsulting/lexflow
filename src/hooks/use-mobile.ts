import * as React from "react"

const MOBILE_BREAKPOINT = 768

// useSyncExternalStore em vez de read-on-mount em efeito: a leitura do
// matchMedia é um estado externo (a regra react-hooks/set-state-in-effect
// recusa o setState síncrono num efeito), e este padrão evita também o
// flood de renders no arranque.
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
