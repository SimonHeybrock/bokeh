import {AbstractButton, AbstractButtonView} from "./abstract_button"
import type {TooltipView} from "../ui/tooltip"
import {Tooltip} from "../ui/tooltip"
import {BuiltinIcon} from "../ui/icons/builtin_icon"
import type {ChildView} from "core/build_views"
import {build_view} from "core/build_views"
import type * as p from "core/properties"

export class HelpButtonView extends AbstractButtonView {
  declare model: HelpButton

  protected tooltip: TooltipView

  /** Whether the tooltip was pinned open by a click on the button. */
  protected _persistent: boolean = false

  override _children_views(): ChildView[] {
    return [...super._children_views(), this.tooltip]
  }

  override async lazy_initialize(): Promise<void> {
    await super.lazy_initialize()
    const {tooltip} = this.model
    this.tooltip = await build_view(tooltip, {parent: this})

    this.on_change(this.tooltip.model.properties.visible, () => {
      const {visible} = this.tooltip.model
      if (!visible) {
        this._persistent = false
      }
      this._toggle(visible)
    })
    this.el.addEventListener("mouseenter", () => {
      this._toggle(true)
    })
    this.el.addEventListener("mouseleave", () => {
      if (!this._persistent) {
        this._toggle(false)
      }
    })
    document.addEventListener("mousedown", (event) => {
      const path = event.composedPath()
      if (path.includes(this.tooltip.el)) {
        return
      } else if (path.includes(this.el)) {
        this._persistent = !this._persistent
        this._toggle(this._persistent)
      } else {
        this._unpin()
      }
    }, {signal: this.abort_signal})
    window.addEventListener("blur", () => {
      this._unpin()
    }, {signal: this.abort_signal})
  }

  protected _unpin(): void {
    this._persistent = false
    this._toggle(false)
  }

  protected _toggle(visible: boolean): void {
    this.tooltip.model.setv({visible, closable: this._persistent})
  }
}

export namespace HelpButton {
  export type Attrs = p.AttrsOf<Props>

  export type Props = AbstractButton.Props & {
    tooltip: p.Property<Tooltip>
  }
}

export interface HelpButton extends HelpButton.Attrs {}

export class HelpButton extends AbstractButton {
  declare properties: HelpButton.Props
  declare __view_type__: HelpButtonView

  constructor(attrs?: Partial<HelpButton.Attrs>) {
    super(attrs)
  }

  static {
    this.prototype.default_view = HelpButtonView

    this.define<HelpButton.Props>(({Ref}) => ({
      tooltip: [ Ref(Tooltip) ],
    }))

    this.override<HelpButton.Props>({
      label: "",
      icon: () => new BuiltinIcon({icon_name: "help", size: 18}),
      button_type: "default",
    })
  }
}
