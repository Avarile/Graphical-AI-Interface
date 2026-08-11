/* @ds-bundle: {"format":4,"namespace":"AaronSansoniDesignSystem_f71563","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Capsule","sourcePath":"components/core/Capsule.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Eyebrow","sourcePath":"components/core/Eyebrow.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"LogoLockup","sourcePath":"components/core/LogoLockup.jsx"},{"name":"StatBlock","sourcePath":"components/core/StatBlock.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"38acc3f5d6a6","components/core/Button.jsx":"51883b374b62","components/core/Capsule.jsx":"afb370ab020c","components/core/Card.jsx":"e0500426cb3e","components/core/Eyebrow.jsx":"1fe50c0cbba7","components/core/Icon.jsx":"6fd02d3d0b27","components/core/Input.jsx":"0053b730014e","components/core/LogoLockup.jsx":"bc7acdc1fd37","components/core/StatBlock.jsx":"e49be388fad8"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.AaronSansoniDesignSystem_f71563 = window.AaronSansoniDesignSystem_f71563 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Small status/label pill. */
function Badge({
  tone = "neutral",
  variant = "soft",
  children,
  style = {},
  ...rest
}) {
  const palettes = {
    neutral: {
      solid: ["var(--black)", "var(--white)"],
      soft: ["var(--ink-100)", "var(--ink-800)"],
      outline: "var(--ink-300)"
    },
    gold: {
      solid: ["var(--gold-500)", "var(--black)"],
      soft: ["var(--gold-100)", "var(--gold-600)"],
      outline: "var(--gold-500)"
    },
    empire: {
      solid: ["var(--empire-600)", "var(--white)"],
      soft: ["var(--empire-100)", "var(--empire-700)"],
      outline: "var(--empire-600)"
    },
    deal: {
      solid: ["var(--deal-600)", "var(--white)"],
      soft: ["var(--deal-100)", "var(--deal-700)"],
      outline: "var(--deal-600)"
    },
    danger: {
      solid: ["var(--danger)", "var(--white)"],
      soft: ["#F7E3E0", "var(--danger)"],
      outline: "var(--danger)"
    }
  };
  const p = palettes[tone] || palettes.neutral;
  let s;
  if (variant === "solid") s = {
    background: p.solid[0],
    color: p.solid[1]
  };else if (variant === "outline") s = {
    background: "transparent",
    color: p.soft[1],
    border: "var(--border-hairline) solid " + p.outline
  };else s = {
    background: p.soft[0],
    color: p.soft[1]
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: "0.35rem",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-caption)",
      fontWeight: "var(--fw-demi)",
      letterSpacing: "var(--ls-wide)",
      textTransform: "uppercase",
      padding: "0.25rem 0.6rem",
      borderRadius: "var(--radius-pill)",
      lineHeight: 1.3,
      ...s,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const sizes = {
  sm: {
    fontSize: "var(--fs-small)",
    padding: "0.5rem 1rem",
    gap: "0.4rem"
  },
  md: {
    fontSize: "var(--fs-body)",
    padding: "0.75rem 1.5rem",
    gap: "0.5rem"
  },
  lg: {
    fontSize: "var(--fs-body-lg)",
    padding: "1rem 2.25rem",
    gap: "0.6rem"
  }
};
const base = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "var(--font-sans)",
  fontWeight: "var(--fw-demi)",
  letterSpacing: "var(--ls-wide)",
  textTransform: "uppercase",
  border: "var(--border-heavy) solid transparent",
  borderRadius: "var(--radius-pill)",
  cursor: "pointer",
  lineHeight: 1,
  transition: "background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard), transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)",
  textDecoration: "none",
  whiteSpace: "nowrap"
};
const variants = {
  primary: {
    background: "var(--accent)",
    color: "var(--black)",
    borderColor: "var(--accent)",
    boxShadow: "var(--shadow-gold)"
  },
  dark: {
    background: "var(--black)",
    color: "var(--white)",
    borderColor: "var(--black)"
  },
  outline: {
    background: "transparent",
    color: "var(--text-strong)",
    borderColor: "var(--border-strong)"
  },
  ghost: {
    background: "transparent",
    color: "var(--text-strong)",
    borderColor: "transparent",
    letterSpacing: "var(--ls-wide)"
  }
};

/**
 * Aaron Sansoni brand button. All-caps, tracked, pill.
 */
function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  fullWidth = false,
  startIcon = null,
  endIcon = null,
  as = "button",
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const v = variants[variant] || variants.primary;
  const hoverStyle = !disabled && hover ? variant === "primary" ? {
    background: "var(--accent-strong)",
    borderColor: "var(--accent-strong)"
  } : variant === "dark" ? {
    background: "var(--ink-800)",
    borderColor: "var(--ink-800)"
  } : variant === "outline" ? {
    background: "var(--black)",
    color: "var(--white)",
    borderColor: "var(--black)"
  } : {
    background: "var(--ink-100)"
  } : {};
  const Comp = as;
  return /*#__PURE__*/React.createElement(Comp, _extends({
    disabled: as === "button" ? disabled : undefined,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...sizes[size],
      ...v,
      ...hoverStyle,
      transform: active && !disabled ? "translateY(1px)" : "translateY(0)",
      width: fullWidth ? "100%" : undefined,
      opacity: disabled ? 0.45 : 1,
      pointerEvents: disabled ? "none" : "auto",
      ...style
    }
  }, rest), startIcon, children, endIcon);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Capsule.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * The signature ASG solid color-block label ("WORLD'S #1…", "DAY 1").
 * Sharp corners, all-caps, tracked.
 */
function Capsule({
  tone = "gold",
  size = "md",
  children,
  style = {},
  ...rest
}) {
  const tones = {
    gold: {
      background: "var(--gold-500)",
      color: "var(--black)"
    },
    empire: {
      background: "var(--empire-600)",
      color: "var(--white)"
    },
    deal: {
      background: "var(--deal-700)",
      color: "var(--gold-400)"
    },
    dark: {
      background: "var(--black)",
      color: "var(--white)"
    },
    light: {
      background: "var(--white)",
      color: "var(--black)"
    }
  };
  const sizes = {
    sm: {
      fontSize: "var(--fs-caption)",
      padding: "0.35rem 0.9rem",
      letterSpacing: "var(--ls-wide)"
    },
    md: {
      fontSize: "var(--fs-body)",
      padding: "0.6rem 1.4rem",
      letterSpacing: "var(--ls-wide)"
    },
    lg: {
      fontSize: "var(--fs-h5)",
      padding: "0.75rem 2rem",
      letterSpacing: "var(--ls-mega)"
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-block",
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--fw-demi)",
      textTransform: "uppercase",
      borderRadius: "var(--radius-none)",
      lineHeight: 1.2,
      ...sizes[size],
      ...(tones[tone] || tones.gold),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Capsule });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Capsule.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Content card — white/dark surface, hairline border, soft shadow. */
function Card({
  elevated = false,
  inverse = false,
  padding = "lg",
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const pads = {
    none: 0,
    sm: "var(--space-4)",
    md: "var(--space-5)",
    lg: "var(--space-6)"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      background: inverse ? "var(--ink-900)" : "var(--surface-card)",
      color: inverse ? "var(--ink-200)" : "var(--text-body)",
      border: "var(--border-hairline) solid " + (inverse ? "var(--ink-700)" : "var(--border-subtle)"),
      borderRadius: "var(--radius-lg)",
      padding: pads[padding],
      boxShadow: elevated ? hover ? "var(--shadow-lg)" : "var(--shadow-md)" : hover ? "var(--shadow-sm)" : "var(--shadow-xs)",
      transition: "box-shadow var(--dur-base) var(--ease-standard), transform var(--dur-base) var(--ease-standard)",
      transform: elevated && hover ? "translateY(-2px)" : "translateY(0)",
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Tracked, all-caps eyebrow label — the "AARON SANSONI" typographic device. */
function Eyebrow({
  as = "div",
  children,
  align = "left",
  style = {},
  ...rest
}) {
  const Comp = as;
  return /*#__PURE__*/React.createElement(Comp, _extends({
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-medium)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      textAlign: align,
      margin: 0,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Lucide icon wrapper. Renders a <span data-lucide> and asks window.lucide to
 * hydrate it into an SVG. Requires the Lucide UMD script on the page:
 *   <script src="https://unpkg.com/lucide@latest"></script>
 * Inherits currentColor; stroke-based, monochrome.
 */
function Icon({
  name,
  size = 20,
  strokeWidth = 2,
  color = "currentColor",
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (window.lucide && ref.current) {
      ref.current.innerHTML = "";
      const el = document.createElement("i");
      el.setAttribute("data-lucide", name);
      ref.current.appendChild(el);
      try {
        window.lucide.createIcons({
          attrs: {
            width: size,
            height: size,
            "stroke-width": strokeWidth
          },
          nameAttr: "data-lucide"
        });
      } catch (e) {}
    }
  }, [name, size, strokeWidth]);
  return /*#__PURE__*/React.createElement("span", _extends({
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      color,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Labeled text input in the brand style — square-ish, focus turns gold. */
function Input({
  label,
  hint,
  error,
  startIcon,
  type = "text",
  style = {},
  id,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const inputId = id || (label ? "in-" + label.replace(/\s+/g, "-").toLowerCase() : undefined);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "0.4rem",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-medium)",
      letterSpacing: "var(--ls-wide)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "0.5rem",
      background: "var(--surface-card)",
      border: "var(--border-regular) solid " + (error ? "var(--danger)" : focus ? "var(--border-gold)" : "var(--border-subtle)"),
      borderRadius: "var(--radius-md)",
      padding: "0.7rem 0.9rem",
      transition: "border-color var(--dur-fast) var(--ease-standard)"
    }
  }, startIcon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      color: "var(--text-muted)"
    }
  }, startIcon), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: type,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-body)",
      color: "var(--text-strong)",
      minWidth: 0
    }
  }, rest))), (hint || error) && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-caption)",
      color: error ? "var(--danger)" : "var(--text-muted)"
    }
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/LogoLockup.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Brand logo / lockup image wrapper. Point src at a shipped asset in assets/logos/. */
function LogoLockup({
  src,
  alt = "Aaron Sansoni",
  height = 48,
  caption,
  invert = false,
  align = "left",
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      flexDirection: "column",
      alignItems: align === "center" ? "center" : "flex-start",
      gap: "0.4rem",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: alt,
    style: {
      height,
      width: "auto",
      display: "block",
      filter: invert ? "invert(1)" : "none"
    }
  }), caption && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-medium)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, caption));
}
Object.assign(__ds_scope, { LogoLockup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/LogoLockup.jsx", error: String((e && e.message) || e) }); }

// components/core/StatBlock.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Large statistic block — big number, tracked label. For results/credibility. */
function StatBlock({
  value,
  label,
  accent = false,
  align = "left",
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "0.3rem",
      textAlign: align,
      alignItems: align === "center" ? "center" : "flex-start",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--fw-bold)",
      fontSize: "var(--fs-h1)",
      lineHeight: 1,
      letterSpacing: "var(--ls-tight)",
      color: accent ? "var(--accent-strong)" : "var(--text-strong)"
    }
  }, value), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--fs-eyebrow)",
      fontWeight: "var(--fw-medium)",
      letterSpacing: "var(--ls-eyebrow)",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label));
}
Object.assign(__ds_scope, { StatBlock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatBlock.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Capsule = __ds_scope.Capsule;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.LogoLockup = __ds_scope.LogoLockup;

__ds_ns.StatBlock = __ds_scope.StatBlock;

})();
