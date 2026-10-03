export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? 'm3-switch disabled' : 'm3-switch'}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="m3-switch-track" aria-hidden="true">
        <span className="m3-switch-thumb" />
      </span>
      <span className="m3-switch-label">{label}</span>
    </label>
  );
}
