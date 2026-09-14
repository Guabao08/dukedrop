# Payment memo length

`PAYMENT_MEMO_MAX_LENGTH` in `app.js` is 280 characters. This is based on Venmo's current help guidance describing a 280-character payment note. Zelle does not publish one network-wide memo limit; individual banks may impose different limits, so DukeDrop uses the conservative Venmo limit for Zelle copy instructions too. Requests split only between complete tracking/order identifiers.
