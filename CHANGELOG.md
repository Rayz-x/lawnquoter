# Changelog

What changed in LawnQuoter for office staff, crews, and customers. Each date is the day the change merged, in US Central time. Numbers in parentheses are pull requests.

Company setup, accounts and properties, satellite measurement, the price catalog, the quote builder, public proposals, and click-to-accept landed on main before pull requests were numbered. They are not listed here.

## 2026-10-10

### Crews

- A crew lead can finish a stop as Partly done with an after photo and a reason. The stop is held for billing review, and a return visit lands unassigned in Needs attention (not on a route). (#92)
- Crew settings include a battery-saver toggle kept on that phone. With it on, the crew map uses an outline basemap with no satellite tiles and animations are reduced. Sun mode stays when the crew picked it; otherwise the dark outdoor theme is used. Office maps are unchanged. (#108)

## 2026-10-09

### Quotes, branding, and maps

- Each company can set a logo, one brand color, and a heading style. Public quotes and PDFs use that look, and the words stay readable even with a light color. (#6)
- A quote with a price range is accepted as a not-to-exceed amount. The customer agrees to pay no more than that cap, and the final bill may be lower. Accepting asks for an email and shows the electronic-signature disclosures. A sealed copy of the signed proposal is emailed when email is set up. A mail program opening the link no longer counts as the customer viewing it. The disclosure wording still needs a lawyer’s review before it is treated as the final customer text. (#8)
- Property addresses are located with Esri and saved on the property, and the map credits Esri. If a new address cannot be located, the old pin is cleared. If that clear fails, staff are warned that the previous pin may still be there. (#7, #9)
- The app uses the Groundwork colors and type on office screens, public quotes, and PDFs. A blank site address no longer stops the app from loading, and unused logo files were removed. (#3, #5)

### Scheduling

- The office can turn an accepted quote into scheduled work, keep recurring agreements, name crews, assign and reorder stops, publish the day, or cancel a stop. Crews see that day in the crew app. (#11, #13, #14)

### Crews

- A visit can store time on site, photos, and upsell requests. Finishing a visit requires an after photo, and a crew can have only one visit running at a time. If the office cancels a visit the crew already finished, that completion is kept and flagged. (#16)
- The phone downloads one crew’s day: addresses, last names, the office phone, gate notes, and the work list. It leaves out the customer’s phone, email, and price. Sending the same update twice does not apply it twice. (#18)
- Crews can install LawnQuoter on a phone. Today’s stops stay on the device, and updates wait there until the phone can send them. The Outbox screen lists what is still waiting. Sign-out warns when updates are still waiting; they stay on the phone until that lead signs in again. (#19, #20, #21)
- The day list shows progress, the next stop, finished stops, access notes, and a drive link. A control switches among sun (high contrast for outdoors), light, and dark. (#22, #24)
- On a stop, the crew lead can start, pause, resume, and finish a timer. A pause does not keep counting after the page reloads. Another open stop blocks starting, and a cancelled stop cannot be started. (#25)
- Before and after photos are taken with the phone camera. The picture is saved on the phone first, and finishing stays blocked until an after photo is on the stop or waiting to send. (#26)
- A stop can be skipped with a reason. Weather and the other ordinary reasons skip right away. A locked gate or a loose dog asks for a photo first. Crews can also flag an upsell with a tag, an optional note, and an optional photo. (#27)
- The phone knows whether the signed-in person is still the crew lead. If something unexpected goes wrong while sending an update, the phone tries again. After five tries, that update is handed to the office so the rest of the visit can still be saved. A photo that never actually uploaded is reported as missing. (#28)
- An upsell with a photo no longer has to look that photo up on the phone before it can be sent. If the office cannot match the photo, the upsell is handed to them, and finishing the stop in the same send still goes through. (#29)

### Access and reliability

- Tightened who can see prices, payment amounts, and gate codes. Field crews do not see quote prices or payment amounts. Only owners and admins can invite people, and those invites expire after a week. After sign-in, the app only sends you to a page inside LawnQuoter. (#10)
- Tightened who can run certain internal tools, including one that exists only on the hosted database. New internal tools are not open to every signed-in person by default. (#17, #23)
- Made automated database tests more reliable by loading the test database from a public registry that was not hitting a download limit. (#30)

## 2026-10-08

- Sending a quote freezes that version. Acceptance records who signed, what they picked, and that they agreed electronically. Accepting again does not create a second signature. Expired quotes cannot be accepted, and an accepted quote cannot be moved back to sent. The proposal, the PDF, and the quote builder add up the same way. Slope, bagging, snow, and a partial lot measurement charge what the pricing rules describe. (#1)
- The title, introduction, and customer notes on a sent quote stay locked until someone revises it. Revising hides the public link until the quote is sent again. (#2)
- An accepted quote, and the signed record that goes with it, cannot be deleted. A steep slope now adds cost in line with the extra hours, the same way bagging does. (#4)
