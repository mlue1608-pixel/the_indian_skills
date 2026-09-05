function doPost(e) {
  try {
    const payload = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};

    const fullName = String(payload.fullName || '').trim();
    const phoneNumber = String(payload.phoneNumber || '').trim();
    const issueCategory = String(payload.issueCategory || '').trim();
    const problemDetails = String(payload.problemDetails || '').trim();
    const screenshotName = String(payload.screenshotName || 'No screenshot uploaded').trim();
    const screenshotBase64 = payload.screenshotBase64 || '';
    const screenshotMime = payload.screenshotMime || 'image/png';

    if (!fullName || !phoneNumber || !issueCategory || !problemDetails) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, error: 'Missing required fields.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const emailBody = [
      'Full Name: ' + fullName,
      'Phone Number: ' + phoneNumber,
      'Issue Category: ' + issueCategory,
      '',
      'Problem Details:',
      problemDetails,
      '',
      'Screenshot: ' + screenshotName,
    ].join('\n');

    const htmlBody = `
      <h2>New Complaint Submitted</h2>
      <p><strong>Full Name:</strong> ${escapeHtml(fullName)}</p>
      <p><strong>Phone Number:</strong> ${escapeHtml(phoneNumber)}</p>
      <p><strong>Issue Category:</strong> ${escapeHtml(issueCategory)}</p>
      <p><strong>Problem Details:</strong></p>
      <p>${escapeHtml(problemDetails).replace(/\n/g, '<br>')}</p>
      <p><strong>Screenshot:</strong> ${escapeHtml(screenshotName)}</p>
    `;

    if (screenshotBase64) {
      const blob = Utilities.newBlob(
        Utilities.base64Decode(screenshotBase64),
        screenshotMime,
        screenshotName
      );

      GmailApp.sendEmail(
        'admin8controls@gmail.com',
        'Complaint: ' + issueCategory + ' - ' + fullName,
        emailBody,
        {
          name: 'The Indian Skills Support',
          htmlBody: htmlBody,
          attachments: [blob]
        }
      );
    } else {
      GmailApp.sendEmail(
        'admin8controls@gmail.com',
        'Complaint: ' + issueCategory + ' - ' + fullName,
        emailBody,
        {
          name: 'The Indian Skills Support',
          htmlBody: htmlBody
        }
      );
    }

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
