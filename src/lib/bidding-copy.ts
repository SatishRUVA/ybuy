export function biddingErrorMessage(message: string): string {
  return message
    .replace(/\bA completed auction\b/g, 'Completed bidding')
    .replace(/\ban enabled auction\b/g, 'enabled bidding')
    .replace(/\bthis auction\b/g, 'this bidding event')
    .replace(/\bAn auction\b/g, 'A bidding event')
    .replace(/\ban auction\b/g, 'a bidding event')
    .replace(/\bAuctions\b/g, 'Bidding events')
    .replace(/\bauctions\b/g, 'bidding events')
    .replace(/\bAuction\b/g, 'Bidding')
    .replace(/\bauction\b/g, 'bidding');
}

export function biddingNotificationCopy(eventKey: string, title: string, body: string): { title: string; body: string } {
  if (eventKey.startsWith('checkout-exception:') && body === 'Do not pay again. Contact support to resolve this late auction payment.') {
    body = 'Do not pay again. Contact support to resolve this late bidding payment.';
  }
  if (!eventKey.startsWith('auction-')) return { title, body };
  const titles: Record<string, string> = {
    'New bid on your auction': 'New bid on your listing',
    'Auction extended': 'Bidding extended',
    'Auction cancelled': 'Bidding cancelled',
    'Auction ended': 'Bidding ended',
    'Auction decision window missed': 'Bidding decision window missed',
    'Choose your auction winner': 'Choose your winning bidder',
    'Choose your auction winners': 'Choose your winning bidders',
  };
  title = titles[title] ?? title;
  const prefix = 'The auction for "';
  if (body.startsWith(prefix)) body = `Bidding for "${body.slice(prefix.length)}`;
  const suffix = '. Open the auction to review your remaining bids.';
  if (body.endsWith(suffix)) body = `${body.slice(0, -suffix.length)}. Open bidding to review your remaining bids.`;
  if (body === 'No bidder was selected before bidding closed. The auction expired without a winner.') {
    body = 'No bidder was selected before bidding closed. Bidding ended without a winner.';
  }
  return { title, body };
}
