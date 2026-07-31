import {Control, ControlView} from "./control"
import type {TooltipView} from "../ui/tooltip"
import {Tooltip} from "../ui/tooltip"
import {HTML, HTMLView} from "../dom/html"

import {isString} from "core/util/types"
import {build_view} from "core/build_views"
import type {StyleSheetLike} from "core/dom"
import {div, label} from "core/dom"
import {View} from "core/view"
import type {ChildView} from "core/view"
import type * as p from "core/properties"
import {server_event, ModelEvent} from "core/bokeh_events"

import inputs_css, * as inputs from "styles/widgets/inputs.css"
import icons_css from "styles/icons.css"

export type HTMLInputElementLike = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

@server_event("clear_input")
export class ClearInput extends ModelEvent {
  constructor(readonly model: InputWidget) {
    super()
    this.origin = model
  }

  static override from_values(values: object): ClearInput {
    const {model} = values as {model: InputWidget}
    return new ClearInput(model)
  }
}

export abstract class InputWidgetView extends ControlView {
  declare model: InputWidget

  protected title: HTMLView | string
  protected description: TooltipView | string | null = null

  protected input_el: HTMLInputElementLike
  protected title_el: HTMLLabelElement
  desc_el: HTMLElement | null = null
  protected icon_el: HTMLElement | null = null
  protected group_el: HTMLElement

  /** Whether the description tooltip was pinned open by a click on its icon. */
  protected _persistent: boolean = false

  public *controls() {
    yield this.input_el
  }

  override _children_views(): ChildView[] {
    const {title, description} = this
    const title_view = title instanceof View ? [title] : []
    const description_view = description instanceof View ? [description] : []
    return [...super._children_views(), ...title_view, ...description_view]
  }

  override initialize(): void {
    super.initialize()

    document.addEventListener("mousedown", (event) => {
      this._on_document_mousedown(event)
    }, {signal: this.abort_signal})
    window.addEventListener("blur", () => {
      this._unpin()
    }, {signal: this.abort_signal})
  }

  override async lazy_initialize(): Promise<void> {
    await super.lazy_initialize()

    await this._build_title()
    await this._build_description()
  }

  override connect_signals(): void {
    super.connect_signals()
    const {title, description} = this.model.properties
    this.on_change(title, async () => {
      await this._build_title()
      this.rerender()
    })
    this.on_change(description, async () => {
      await this._build_description()
      this.rerender()
    })
  }

  override stylesheets(): StyleSheetLike[] {
    return [...super.stylesheets(), inputs_css, icons_css]
  }

  override render(): void {
    super.render()

    this.desc_el = this._build_description_el()
    this.title_el = this._build_title_el()

    const input_or_container_el = this._render_input()
    this.input_el.id = "input"
    this.group_el = div({class: inputs.input_group}, this.title_el, input_or_container_el)
    this.shadow_el.append(this.group_el)
  }

  protected _build_description_el(): HTMLElement | null {
    const {description} = this
    if (description == null) {
      this.icon_el = null
      return null
    } else {
      const icon_el = div({class: inputs.icon})
      const desc_el = div({class: inputs.description}, icon_el)
      this.icon_el = icon_el

      if (isString(description)) {
        desc_el.title = description
      } else {
        if (description.model.target == "auto") {
          description.target_override.value = desc_el
        }

        desc_el.addEventListener("mouseenter", () => {
          this._toggle_description(true)
        })
        desc_el.addEventListener("mouseleave", () => {
          if (!this._persistent) {
            this._toggle_description(false)
          }
        })
      }
      return desc_el
    }
  }

  /**
   * Clicking the description's icon pins the tooltip open, clicking anywhere
   * outside of the icon and the tooltip itself unpins and hides it.
   */
  protected _on_document_mousedown(event: MouseEvent): void {
    const {description, desc_el} = this
    if (!(description instanceof View) || desc_el == null) {
      return
    }
    const path = event.composedPath()
    if (path.includes(description.el)) {
      return
    } else if (path.includes(desc_el)) {
      this._persistent = !this._persistent
      this._toggle_description(this._persistent)
    } else {
      this._unpin()
    }
  }

  protected _unpin(): void {
    this._persistent = false
    this._toggle_description(false)
  }

  protected _toggle_description(visible: boolean): void {
    const {description} = this
    if (!(description instanceof View)) {
      return
    }
    description.model.setv({visible, closable: this._persistent})
    this.icon_el?.classList.toggle(inputs.opaque, visible && this._persistent)
  }

  protected _on_description_visible(): void {
    const {description} = this
    if (!(description instanceof View)) {
      return
    }
    const {visible} = description.model
    if (!visible) {
      this._persistent = false
    }
    this._toggle_description(visible)
  }

  protected async _build_title(): Promise<void> {
    if (this.title instanceof View) {
      this.title.remove()
    }
    const {title} = this.model
    if (title instanceof HTML) {
      this.title = await build_view(title, {parent: this})
    } else {
      this.title = title
    }
  }

  protected async _build_description(): Promise<void> {
    const {description: previous} = this
    if (previous instanceof View) {
      this.disconnect(previous.model.properties.visible.change, this._on_description_visible)
      previous.remove()
    }
    this._persistent = false

    const {description} = this.model
    if (description instanceof Tooltip) {
      this.description = await build_view(description, {parent: this})
      this.connect(description.properties.visible.change, this._on_description_visible)
    } else {
      this.description = description
    }
  }

  protected _build_title_el(): HTMLLabelElement {
    const {title} = this
    const content = (() => {
      if (title instanceof HTMLView) {
        title.render()
        return title.el
      } else {
        return title
      }
    })()
    const display = title == "" ? "none" : ""
    return label({for: "input", style: {display}}, content, this.desc_el)
  }

  protected abstract _render_input(): HTMLElement

  change_input(): void {}
}

export namespace InputWidget {
  export type Attrs = p.AttrsOf<Props>

  export type Props = Control.Props & {
    title: p.Property<string | HTML>
    description: p.Property<string | Tooltip | null>
  }
}

export interface InputWidget extends InputWidget.Attrs {}

export abstract class InputWidget extends Control {
  declare properties: InputWidget.Props
  declare __view_type__: InputWidgetView

  constructor(attrs?: Partial<InputWidget.Attrs>) {
    super(attrs)
  }

  static {
    this.define<InputWidget.Props>(({Str, Nullable, Or, Ref}) => ({
      title: [ Or(Str, Ref(HTML)), "" ],
      description: [ Nullable(Or(Str, Ref(Tooltip))), null ],
    }))
  }
}
