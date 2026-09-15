const DIRECT_ADMIN_EMAIL = 'admin8controls@gmail.com';
const ENROLLMENTS_TABLE = 'Enrollments';
const PENDING_USERS_TABLE = 'pending_users';
let supabaseClient;

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
    course: firstValue(enrollment, ['course_name', 'package_name', 'course', 'course_title'], 'Unspecified course'),
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



function renderPendingSignups(pendingUsers) {
  if (!pendingUsers.length) {
    elements.pendingRows.innerHTML = '<tr><td colspan="5" class="empty">No pending signups found.</td></tr>';
    return;
  }

  elements.pendingRows.innerHTML = pendingUsers.map(user => {
    const name = firstValue(user, ['full_name', 'name', 'student_name'], 'Pending user');
    const email = firstValue(user, ['email', 'student_email'], 'Email unavailable');
    const courseName = firstValue(user, ['course_name', 'package_name', 'course'], 'Unspecified course');
    const status = String(firstValue(user, ['status'], 'pending')).trim();

    return `<tr>
      <td><div class="student"><span class="studentAvatar">${escapeHtml(initials(name))}</span><span class="studentName">${escapeHtml(name)}</span></div></td>
      <td>${escapeHtml(email)}</td>
      <td>${escapeHtml(courseName)}</td>
      <td><span class="status pending">${escapeHtml(status)}</span></td>
      <td><button class="approve" data-pending-id="${escapeHtml(user.id)}" data-source="${escapeHtml(user.source)}">Approve</button></td>
    </tr>`;
  }).join('');
}



let dashboardRequest = null;
async function fetchDashboardData() {
  if (dashboardRequest) return dashboardRequest;
  const refresh = document.getElementById('refreshButton');
  refresh.disabled = true;
  dashboardRequest = loadDashboardData();
  try { return await dashboardRequest; }
  finally { dashboardRequest = null; refresh.disabled = false; }
}

async function loadDashboardData(){
 elements.rows.innerHTML='<tr><td colspan="6" class="loading">Loading enrollment records...</td></tr>';
 elements.pendingRows.innerHTML='<tr><td colspan="5" class="loading">Loading pending signups...</td></tr>';
 try{
 const {data,error}=await supabaseClient.rpc('tis_admin_dashboard');if(error)throw error;
 elements.totalStudents.textContent=data.totalStudents;elements.totalEnrollments.textContent=data.totalEnrollments;elements.totalRevenue.textContent=formatAmount(data.totalRevenue);
 renderEnrollments(data.enrollments||[]);
 renderPendingSignups([...(data.enrollments||[]).filter(row=>String(row.status).toLowerCase()==='pending').map(row=>({...row,source:'enrollment'})),...(data.pending||[]).map(row=>({...row,source:'legacy'}))]);
 }catch(error){console.error('[Admin]',error);elements.rows.innerHTML='<tr><td colspan="6" class="error">'+escapeHtml(window.TISBackend.describeError(error))+' Click Refresh to retry.</td></tr>';elements.pendingRows.innerHTML='<tr><td colspan="5" class="error">Unable to load pending signups. Click Refresh to retry.</td></tr>';[elements.totalStudents,elements.totalEnrollments,elements.totalRevenue].forEach(el=>el.textContent='Unable to load');}
}

async function approvePendingSignup(button){
 if(button.disabled)return;button.disabled=true;button.textContent='Approving...';
 try{
 const result=button.dataset.source==='legacy'?await supabaseClient.functions.invoke('approve-pending-user',{body:{pendingId:button.dataset.pendingId}}):await supabaseClient.rpc('tis_approve_enrollment',{p_id:button.dataset.pendingId});
 if(result.error||result.data?.error)throw result.error||Error(result.data.error);
 await fetchDashboardData();
 }catch(error){button.disabled=false;button.textContent='Approve';alert(error.message||'Unable to approve signup.');}
}

async function authorizeAndLoad() {
  const accessStatus = document.getElementById('accessStatus');
  accessStatus.hidden = false;
  accessStatus.textContent = 'Checking administrator access...';
  try {
    supabaseClient ||= window.TISBackend.createClient(window.supabase);
    const { data: sessionData, error: sessionError } = await window.TISBackend.getUsableSession(supabaseClient.auth);
    if (sessionError) throw sessionError;
    if (!sessionData.session?.user) {
      denyAccess();
      return;
    }

    const user = sessionData.session.user;
    const { data: isAdmin, error: adminError } = await supabaseClient.rpc('tis_is_admin');
    if (adminError) throw adminError;
    if (isAdmin !== true) {
      denyAccess();
      return;
    }

    elements.adminEmail.textContent = user.email || 'Admin';
    elements.adminAvatar.textContent = initials(user.email || 'Admin');
    elements.app.hidden = false;
    accessStatus.hidden = true;
    await fetchDashboardData();
  } catch (error) {
    if (error.code !== 'TIS_LOCAL_FILE') console.error('Admin panel failed to load:', error);
    elements.app.hidden = true;
    accessStatus.hidden = false;
    accessStatus.textContent = (window.TISBackend?.describeError(error) || 'Unable to load the connection setup. Please refresh this page.') + ' ';
    const localFile = error.code === 'TIS_LOCAL_FILE';
    const retry = document.createElement(localFile ? 'a' : 'button');
    retry.className = 'refresh';
    if (localFile) {
      retry.href = 'http://127.0.0.1:5501/THE_INDIAN_SKILLS.html' + window.location.search + window.location.hash;
      retry.textContent = 'Open local site';
    } else {
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.addEventListener('click', authorizeAndLoad);
    }
    accessStatus.appendChild(retry);
    const connectionCheck = document.createElement('a');
    connectionCheck.href = 'connection-check.html';
    connectionCheck.target = '_blank';
    connectionCheck.rel = 'noopener';
    connectionCheck.textContent = 'Check connection';
    connectionCheck.className = 'refresh';
    accessStatus.appendChild(connectionCheck);
    elements.rows.innerHTML = '<tr><td colspan="6" class="error">Unable to load dashboard data. Please refresh and try again.</td></tr>';
  }
}

document.getElementById('refreshButton').addEventListener('click', fetchDashboardData);
elements.pendingRows.addEventListener('click', event => {
  const button = event.target.closest('.approve');
  if (button) approvePendingSignup(button);
});
document.getElementById('logoutButton').addEventListener('click', async () => {
  try {
    const {error} = await supabaseClient.auth.signOut();
    if(error)throw error;
    redirectToHome();
  }catch(error){alert(window.TISBackend.describeError(error));}
});
document.getElementById('mobileMenu').addEventListener('click', () => {
  elements.sidebar.classList.toggle('open');
});
elements.sidebar.querySelectorAll('a').forEach(link => link.addEventListener('click', () => elements.sidebar.classList.remove('open')));

authorizeAndLoad();
