import React, { useState, useRef } from 'react'
import { Menu, Search, Map, X } from 'lucide-react'
import { useMapStore, activeMapSelector } from '@/store/mapStore'
import { useUiStore } from '@/store/uiStore'
import { parseCoordinateString } from '@/lib/coordinates'
import { cn } from '@/lib/utils'

export const TopBar: React.FC = () => {
  const activeMap = useMapStore(activeMapSelector)
  const toggleDrawer = useUiStore((s) => s.toggleDrawer)
  const openSheet = useUiStore((s) => s.openSheet)
  const searchQuery = useUiStore((s) => s.searchQuery)
  const setSearchQuery = useUiStore((s) => s.setSearchQuery)

  const [searchFocused, setSearchFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  interface SearchResult {
    name: string
    lat: number
    lon: number
  }

  const handleSearchInput = (value: string) => {
    setSearchQuery(value)
    if (!value.trim()) { setSearchResults([]); return }

    // First try parsing as coordinates
    const coords = parseCoordinateString(value)
    if (coords) {
      setSearchResults([{ name: `${value} (coordinate)`, lat: coords.lat, lon: coords.lon }])
      return
    }

    // Otherwise geocode via Nominatim after debounce
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setIsSearching(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=5`,
          { headers: { 'Accept-Language': 'en' } },
        )
        const data = await res.json() as Array<{ display_name: string; lat: string; lon: string }>
        setSearchResults(data.map((d) => ({
          name: d.display_name,
          lat: parseFloat(d.lat),
          lon: parseFloat(d.lon),
        })))
      } catch {
        setSearchResults([])
      } finally {
        setIsSearching(false)
      }
    }, 500)
  }

  const handleResultClick = (result: SearchResult) => {
    // TODO: pan map to result
    console.log('Navigate to:', result)
    setSearchQuery('')
    setSearchResults([])
    inputRef.current?.blur()
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchResults([])
    inputRef.current?.focus()
  }

  return (
    <header className="h-12 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50 flex items-center gap-2 px-3 z-40 relative shrink-0">
      {/* Menu button */}
      <button
        onClick={toggleDrawer}
        className="p-2 rounded-lg hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
        aria-label="Toggle map library"
      >
        <Menu size={20} />
      </button>

      {/* App icon + map name */}
      <div
        className="flex items-center gap-2 shrink-0 cursor-pointer"
        onClick={() => openSheet('import-map')}
        title="Import a map"
      >
        <Map size={18} className="text-blue-400" />
        <span className="text-sm font-semibold text-slate-100 max-w-[140px] truncate hidden sm:block">
          {activeMap ? activeMap.name : 'GeoPDF Viewer'}
        </span>
      </div>

      {/* Search bar */}
      <div className="flex-1 relative">
        <div className={cn(
          'flex items-center gap-2 bg-slate-800 border rounded-lg px-3 py-1.5 transition-colors',
          searchFocused ? 'border-blue-500' : 'border-slate-600',
        )}>
          <Search size={15} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder="Search coordinates or places…"
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none min-w-0"
            aria-label="Search coordinates or places"
          />
          {searchQuery && (
            <button onClick={clearSearch} className="text-slate-400 hover:text-slate-200 shrink-0">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Search results dropdown */}
        {searchFocused && (searchResults.length > 0 || isSearching) && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden z-50">
            {isSearching && (
              <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
            )}
            {searchResults.map((result, i) => (
              <button
                key={i}
                onMouseDown={() => handleResultClick(result)}
                className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0"
              >
                <div className="font-medium truncate">{result.name}</div>
                <div className="text-xs text-slate-400">
                  {result.lat.toFixed(5)}, {result.lon.toFixed(5)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Import button (desktop) */}
      <button
        onClick={() => openSheet('import-map')}
        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors shrink-0 font-medium"
        aria-label="Import map"
      >
        + Import
      </button>
    </header>
  )
}
