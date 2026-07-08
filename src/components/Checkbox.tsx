import { CheckIcon } from "./icons";

export function Checkbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label className="cb">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span className="cb__box">{checked && <CheckIcon />}</span>
    </label>
  );
}
