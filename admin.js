const SUPABASE_URL = 'https://rhcddqqoajcejtuzaquc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_MNpVU2BSZSGykvo9crfVxw_Dv7KTzwu';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

const elements = {
  app: document.getElementById('app'),
  rows: document.getElementById('enrollmentRows'),
  pendingRows: document.getElementById('pendingRows'),
  totalStudents: document.getElementById('totalStudents'),
  totalEnrollments: document.getElementById('totalEnrollments'),
  totalRevenue: document.getElementById('totalRevenue'),
  adminEmail: document.getElementById('adminEmail'),
  adminAvatar: document.getElementById('adminAvatar'),
  sidebar: document.getElementById('sidebar')
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function redirectToHome() {
  window.location.replace('THE_INDIAN_SKILLS.html');
}

function denyAccess() {
  alert('Access Denied');
  redirectToHome();
}

function firstValue(record, keys, fallback = '') {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') {
      return record[key];
    }
  }
  return fallback;
}

function formatAmount(value) {
  const amount = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(amount)) return 'INR 0';
  return `INR ${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function initials(name) {
  return String(name || 'Student').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S';
}

function getEnrollmentDetails(enrollment) {
  const user = enrollment.user || enrollment.profile || {};
  const name = firstValue(enrollment, ['name', 'full_name', 'student_name'], firstValue(user, ['name', 'full_name'], 'Student'));
  const email = firstValue(enrollment, ['email', 'student_email'], firstValue(user, ['email'], ''));
  return {
    name,
    email,
    course: firstValue(enrollment, ['course_name', 'course', 'course_title'], 'Unspecified course'),
    paymentMethod: firstValue(enrollment, ['payment_method', 'paymentMethod', 'method'], 'Not provided'),
    amount: firstValue(enrollment, ['amount', 'price', 'payment_amount'], 0),
    status: firstValue(enrollment, ['status', 'payment_status'], 'Pending')
  };
}

function renderEnrollments(enrollments) {
  if (!enrollments.length) {
    elements.rows.innerHTML = '<tr><td colspan="6" class="empty">No enrollments found.</td></tr>';
    return;
  }
  elements.rows.innerHTML = enrollments.map(enrollment => {
    const details = getEnrollmentDetails(enrollment);
    const statusClass = String(details.status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<tr>
      <td><div class="student"><span class="studentAvatar">${escapeHtml(initials(details.name))}</span><span class="studentName">${escapeHtml(details.name)}</span></div></td>
      <td class="studentEmail">${escapeHtml(details.email || 'Email unavailable')}</td>
      <td>${escapeHtml(details.course)}</td>
      <td>${escapeHtml(details.paymentMethod)}</td>
      <td class="amount">${escapeHtml(formatAmount(details.amount))}</td>
      <td><span class="status ${escapeHtml(statusClass)}">${escapeHtml(details.status)}</span></td>
    </tr>`;
  }).join('');
}

function renderMetrics(enrollments) {
  const students = new Set(enrollments.map(enrollment => enrollment.user_id || enrollment.email || enrollment.student_email).filter(Boolean));
  const totalRevenue = enrollments.reduce((sum, enrollment) => {
    const amount = Number.parseFloat(String(firstValue(enrollment, ['amount', 'price', 'payment_amount'], 0)).replace(/[^0-9.-]/g, ''));
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
  elements.totalStudents.textContent = students.size || enrollments.filter(enrollment => getEnrollmentDetails(enrollment).name !== 'Student').length;
  elements.totalEnrollments.textContent = enrollments.length;
  elements.totalRevenue.textContent = formatAmount(totalRevenue);
}

function renderPendingSignups(pendingUsers) {
  if (!pendingUsers.length) {
    elements.pendingRows.innerHTML = '<tr><td colspan="9" class="empty">No pending signups found.</td></tr>';
    return;
  }
  elements.pendingRows.innerHTML = pendingUsers.map(user => `<tr>
    <td><div class="student"><span class="studentAvatar">${escapeHtml(initials(user.full_name))}</span><span class="studentName">${escapeHtml(user.full_name)}</span></div></td>
    <td>${escapeHtml(user.email)}<br><span class="studentEmail">${escapeHtml(user.phone)}</span></td>
    <td>${escapeHtml(user.package_name)}</td>
    <td class="amount">${escapeHtml(formatAmount(user.original_price))}</td>
    <td class="amount">${escapeHtml(formatAmount(user.paid_price || user.referral_discount_price))}</td>
    <td>${user.referral_code ? `Yes (${escapeHtml(user.referral_code)})` : 'No'}</td>
    <td>${escapeHtml(user.utr_number || user.payment_details?.utr_number || 'Not provided')}</td>
    <td>${escapeHtml(user.payment_method)}</td>
    <td><button class="approve" data-pending-id="${escapeHtml(user.id)}">Approve</button></td>
  </tr>`).join('');
}

function getLocalPendingSignups() {
  try {
    return JSON.parse(localStorage.getItem('tisPendingUsers') || '[]')
      .filter(user => user.status === 'pending');
  } catch (error) {
    console.error('Unable to read local pending signups:', error);
    return [];
  }
}

async function fetchDashboardData() {
  elements.rows.innerHTML = '<tr><td colspan="6" class="loading">Loading enrollment records...</td></tr>';
  elements.pendingRows.innerHTML = '<tr><td colspan="9" class="loading">Loading pending signups...</td></tr>';
  let enrollments = [];
  let profiles = [];
  let pendingUsers = [];

  try {
    const { data, error } = await supabaseClient
      .from('Enrollments')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    enrollments = data || [];
  } catch (error) {
    console.error('Unable to fetch enrollments:', error);
  }

  try {
    const { data, error } = await supabaseClient.from('profiles').select('*');
    if (error) throw error;
    profiles = data || [];
  } catch (error) {
    console.error('Unable to fetch profiles:', error);
  }

  try {
    const { data, error } = await supabaseClient.from('pending_users').select('*').eq('status', 'pending').order('created_at', { ascending: false });
    if (error) throw error;
    pendingUsers = data || [];
  } catch (error) {
    console.error('Unable to fetch pending signups:', error);
    pendingUsers = getLocalPendingSignups();
    if (!pendingUsers.length) {
      elements.pendingRows.innerHTML = '<tr><td colspan="9" class="error">Pending signups table is not configured. Run supabase_pending_approval.sql.</td></tr>';
    }
  }

  const profilesByUserId = new Map(profiles
    .map(profile => [profile.id || profile.user_id, profile])
    .filter(([userId]) => userId));
  const records = enrollments.map(enrollment => ({
    ...enrollment,
    profile: profilesByUserId.get(enrollment.user_id) || {}
  }));
  renderMetrics(records);
  renderEnrollments(records);
  renderPendingSignups(pendingUsers);
}

async function approvePendingSignup(button) {
  button.disabled = true;
  button.textContent = 'Approving...';
  if (button.dataset.pendingId.startsWith('local-')) {
    const localRecords = getLocalPendingSignups().filter(user => user.id !== button.dataset.pendingId);
    localStorage.setItem('tisPendingUsers', JSON.stringify(localRecords));
    await fetchDashboardData();
    return;
  }
  const { data, error } = await supabaseClient.functions.invoke('approve-pending-user', {
    body: { pendingId: button.dataset.pendingId }
  });
  if (error || data?.error) {
    button.disabled = false;
    button.textContent = 'Approve';
    alert(error?.message || data.error);
    return;
  }
  await fetchDashboardData();
}

async function authorizeAndLoad() {
  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      denyAccess();
      return;
    }

    const user = sessionData.session.user;
    const isDirectAdmin = user.email?.trim().toLowerCase() === 'admin8controls@gmail.com';
    if (!isDirectAdmin) {
      const { data: profile, error: profileError } = await supabaseClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError || profile?.role !== 'admin') {
        denyAccess();
        return;
      }
    }

    elements.adminEmail.textContent = user.email || 'Admin';
    elements.adminAvatar.textContent = initials(user.email || 'Admin');
    elements.app.hidden = false;
    await fetchDashboardData();
  } catch (error) {
    console.error('Admin panel failed to load:', error);
    elements.rows.innerHTML = '<tr><td colspan="6" class="error">Unable to load dashboard data. Please refresh and try again.</td></tr>';
  }
}

document.getElementById('refreshButton').addEventListener('click', fetchDashboardData);
elements.pendingRows.addEventListener('click', event => {
  const button = event.target.closest('.approve');
  if (button) approvePendingSignup(button);
});
document.getElementById('logoutButton').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  redirectToHome();
});
document.getElementById('mobileMenu').addEventListener('click', () => {
  elements.sidebar.classList.toggle('open');
});
elements.sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', () => elements.sidebar.classList.remove('open')));

authorizeAndLoad();
