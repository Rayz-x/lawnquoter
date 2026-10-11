# Changelog

What changed in LawnQuoter for office staff, crews, and customers. Each date is the day the change merged, in US Central time. Numbers in parentheses are pull requests.

Company setup, accounts and properties, satellite measurement, the price catalog, the quote builder, public proposals, and click-to-accept landed on main before pull requests were numbered. They are not listed here.

## 2026-10-10

### Accounts

- Account, property, price, and company screens save one section at a time. A choice or a number saves immediately. Notes and most text save shortly after you stop typing. If a save fails, the last saved value comes back. (#36, #44)
- An account shows the customer, a short strip of facts, and tabs for properties and contacts. Adding a property can suggest an address and then open measuring. A contact can be marked primary, for billing, or for text messages. (#37, #41)
- Billing terms, who created the account, and internal notes sit beside the account on a wide screen and under it on a phone. The billing email stays empty until someone types it. The account email is only a hint under that field. (#42)
- New customers are added from the accounts list. The account starts as a lead. When an address is filled in, the next step is measuring the lot. (#46)
- The property page shows the lot facts, the map, mowing conditions, and access notes, and there is no separate Save for the whole page. The gate code can be shown or hidden and saves when you leave the field. Dogs on site mark the access card. (#38, #59)
- Every account, including a home, has a Billing details section. The billing email stays blank until someone enters it. The billing address starts as the first property. (#156)
- Lead source is a fixed list: Google, referral, door hanger, yard sign, repeat, or other. Other asks for a short description. Website form is filled in by the system, not chosen by staff. (#137)
- Accepting a quote, or turning that quote into scheduled work, moves a lead account to active. An archived account stays archived. The account menu can activate or archive the account. (#154)

### Pricing and company settings

- Services and prices open as a searchable list and a tier table (how much, the price, the hours, and the cost) that saves as you go. Adjustments for the property save when you leave that field. (#39, #40)
- Company settings are edited by section, and only owners and admins can change them. Quote expiry, the deposit, and which day the week starts are not on that screen. (#43)
- Slope, a narrow gate, and the service minimum still apply when a price list has no extra adjustments saved. A service added from the catalog is priced from that list, not from a number typed onto the quote. (#60, #61)

### Quotes

- Staff can search the catalog when adding a line, and can reorder lines. On a phone the line controls stack, and move up or down is in the line menu. (#47, #57)
- The quote reads as one record: the customer, the property, the proposal text, terms, and internal notes. Cost and margin stay hidden until someone opens them. On a phone, Send sits in a bar at the bottom. (#48)
- A hand-typed line price has to fall between that line's low and high. Leaving both ends blank stores no range. (#65)

### Measuring

- Changing the recorded size of a drawn outline keeps the area the map measured. (#63)
- If a new measurement cannot retire the previous one, the save stops and the previous measurement stays current. (#64)

### Site checks

- Some quote lines are flagged to confirm on site. The public quote and the PDF mark those lines and say the crew will confirm on site within five days of acceptance. The customer still agrees to pay no more than the high ends of those flagged lines added together. The check is created when the customer accepts, not when the quote is sent. (#133, #134, #135)
- The customer can request a final price. Until the office approves a visit date, the page says that date will be confirmed shortly. If the office declines, the customer sees the reason and can still accept the quoted range. (#139)
- A crew can see a site check for their stop without the email or note the customer sent with the request. (#115)

### Scheduling

- Recurring agreements keep about ten weeks of upcoming visits filled in each night. The agreement shows how far those visits run. Visits already started, moved, or cancelled are left as they are. (#106)
- The schedule has a Needs attention list: unassigned stops, overdue stops, stops that need another day, and return visits or flags such as an upsell. From a card the office can assign, move, skip, or cancel. (#112)
- Rain day moves that day's scheduled stops to the next work day. Saturday is skipped unless the company works Saturdays, so Friday moves to Monday. A stop already underway stays put. If the new day would land on that property's next regular visit, the stop is skipped for weather instead of being doubled up. (#146)
- The schedule shows whether each crew phone has today's route, including a phone that has never checked in or still has an older route. The crew phone says when a stop was added or removed. (#107)

### Crews

- Skip reasons: weather skips right away; a locked gate or loose dog needs an after photo (same rule as finishing); a dog skip marks the property as having dogs; an unsafe skip needs a note, may include a photo, and shows as urgent. Skipped stops land in Needs reschedule. (#95)
- A crew lead can finish a stop as Partly done with an after photo and a reason. The stop is held for billing review, and a return visit lands unassigned in Needs attention (not on a route). (#92)
- Crew settings include a battery-saver toggle kept on that phone. With it on, the crew map uses an outline basemap with no satellite tiles and animations are reduced. Sun mode stays when the crew picked it; otherwise the dark outdoor theme is used. Office maps are unchanged. (#114)
- Gate codes show on the crew phone for yesterday, today, and tomorrow, using the company clock. A stop left in progress from an earlier day stays on the phone, including its gate code. The phone's own clock does not extend that window. (#113, #138)
- Visit photos can save the phone's location. (#51)
- If the lead for a day changes, updates the previous lead already made still go through for the time they were lead. Someone who is not the lead cannot start or finish a stop. Switching leads leaves a visit that is already running, and its timer, as they are. (#109)

### Leads

- Lead sources, in the office menu, shows how long leads wait for a first contact and how often each source becomes a customer. (#149, #151)
- Opening a lead lets the office log a contact, assign someone, set a follow-up date, and read a timeline of those notes. The menu does not list every lead. (#153, #151)
- When a quote tied to a lead is declined or expires, the office is asked why that lead was lost. A reason is required. (#152)
- A rough in-house price from the lot size stays off public pages, emails, and the office screens for now. A missing lot size is left blank rather than treated as zero. (#150)
- Around 7 in the morning, each person with follow-ups due or overdue gets one email listing them, when email is set up. (#140)

### Invoices and payments

- Invoice drafts, payments, and credits are kept for the office. Field crews cannot see them. When an invoice is issued, it gets the next number for that year, with no gaps, and the tax and total stay locked. Only owners and admins can issue one. The office menu does not have an invoices screen yet. (#105, #145)
- The company owner can connect the company's own Stripe account from Settings. Card payments are meant to go to that account. Accepting a quote still only records the signature. (#110)

### Access and reliability

- A failed load on an office page shows an error instead of an empty list, a blank company screen, or a measurement with nothing on it. That empty measurement can no longer be saved over the lot that was already stored. (#56)
- Links to a leads list, bids, invoices, and analytics opened a missing page, so those links were taken out of the office menu. (#50)
- Work that does not change what people see: unused parts of the office app were removed, extra automatic checks were added, a missing setup command was added, and notes for the people maintaining the software were updated. (#49, #52, #53, #55, #58, #62, #66)

## 2026-10-09

### Quotes, branding, and maps

- Each company can set a logo, one brand color, and a heading style. Public quotes and PDFs use that look, and the words stay readable even with a light color. (#6)
- A quote with a price range is accepted as a not-to-exceed amount. The customer agrees to pay no more than that cap, and the final bill may be lower. Accepting asks for an email and shows the electronic-signature disclosures. A sealed copy of the signed proposal is emailed when email is set up. A mail program opening the link no longer counts as the customer viewing it. The disclosure wording still needs a lawyer’s review before it is treated as the final customer text. (#8)
- Property addresses are located with Esri and saved on the property, and the map credits Esri. If a new address cannot be located, the old pin is cleared. If that clear fails, staff are warned that the previous pin may still be there. (#7, #9)
- The app uses the Groundwork colors and type on office screens, public quotes, and PDFs. A blank site address no longer stops the app from loading, and unused logo files were removed. (#3, #5)
- Tab labels size to the words in them, so a longer label no longer covers the next tab. The row scrolls sideways when it does not fit. (#32)
- Satellite photos stop at the last useful zoom instead of being replaced by an empty tile when you zoom in further. (#33)
- Drawing a lot places a point on a click or a short drag. The map does not slide until the select tool is on. (#34)
- Lot outlines, parcel lines, and the address pin draw on top of the satellite photo. (#35)

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
- The setup guide and this change history were brought up to date with the app. (#31)

## 2026-10-08

- Sending a quote freezes that version. Acceptance records who signed, what they picked, and that they agreed electronically. Accepting again does not create a second signature. Expired quotes cannot be accepted, and an accepted quote cannot be moved back to sent. The proposal, the PDF, and the quote builder add up the same way. Slope, bagging, snow, and a partial lot measurement charge what the pricing rules describe. (#1)
- The title, introduction, and customer notes on a sent quote stay locked until someone revises it. Revising hides the public link until the quote is sent again. (#2)
- An accepted quote, and the signed record that goes with it, cannot be deleted. A steep slope now adds cost in line with the extra hours, the same way bagging does. (#4)
