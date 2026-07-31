import {expect} from "#framework/assertions"
import {display} from "#framework/layouts"

import {HelpButton} from "@bokehjs/models/widgets"
import {Tooltip} from "@bokehjs/models/ui/tooltip"

describe("HelpButtonView", () => {
  it("should keep a pinned tooltip in sync with the button across re-renders", async () => {
    const tooltip = new Tooltip({content: "help", position: "bottom_center"})
    const button = new HelpButton({tooltip, label: "a label"})
    const {view} = await display(button, [200, 50])

    function click_button(): void {
      view.el.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, composed: true}))
    }

    click_button()
    expect(tooltip.visible).to.be.true

    button.label = "another label"
    await view.ready

    click_button()
    expect(tooltip.visible).to.be.false
  })
})
