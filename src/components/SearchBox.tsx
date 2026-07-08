import { SearchIcon, XIcon } from "./icons";

export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="search">
      <SearchIcon />
      <input
        type="search"
        placeholder="Search by port, process, or project…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          className="search__clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}
