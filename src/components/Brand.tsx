import logo from "../assets/logo.png";

export function Brand() {
  return (
    <div className="brand">
      <img src={logo} alt="" className="brand__logo" />
      <div className="brand__text">
        <h1>Dockyard</h1>
        <span className="brand__subtitle">Ports running on your Mac</span>
      </div>
    </div>
  );
}
