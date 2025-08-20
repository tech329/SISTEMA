// Utility functions for number formatting and responsive optimization

// Format number inputs to always show 2 decimals
export function formatNumberInput(input) {
  input.addEventListener('blur', function() {
    const value = parseFloat(this.value);
    if (!isNaN(value)) {
      this.value = value.toFixed(2);
    }
  });
  
  input.addEventListener('input', function() {
    // Remove any non-numeric characters except decimal point
    this.value = this.value.replace(/[^0-9.]/g, '');
    
    // Ensure only one decimal point
    const parts = this.value.split('.');
    if (parts.length > 2) {
      this.value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limit to 2 decimal places
    if (parts[1] && parts[1].length > 2) {
      this.value = parts[0] + '.' + parts[1].substring(0, 2);
    }
  });
}

// Initialize number formatting for all number inputs in a container
export function initializeNumberFormatting(container = document) {
  const numberInputs = container.querySelectorAll('input[type="number"][step="0.01"]');
  numberInputs.forEach(input => {
    formatNumberInput(input);
  });
}

// Custom Alert System
export function showCustomAlert(options = {}) {
  const {
    title = 'Aviso',
    message = '',
    type = 'info', // 'info', 'warning', 'error', 'success', 'confirm'
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    onConfirm = null,
    onCancel = null
  } = options;

  const alertModal = document.getElementById('custom-alert');
  const alertIcon = document.getElementById('alert-icon');
  const alertTitle = document.getElementById('alert-title');
  const alertMessage = document.getElementById('alert-message');
  const confirmBtn = document.getElementById('alert-confirm');
  const cancelBtn = document.getElementById('alert-cancel');

  if (!alertModal) {
    console.error('Custom alert modal not found');
    return;
  }

  // Set icon and colors based on type
  const icons = {
    info: '💬',
    warning: '⚠️',
    error: '❌',
    success: '✅',
    confirm: '❓'
  };

  const colors = {
    info: 'bg-blue-600 hover:bg-blue-700',
    warning: 'bg-yellow-600 hover:bg-yellow-700',
    error: 'bg-red-600 hover:bg-red-700',
    success: 'bg-green-600 hover:bg-green-700',
    confirm: 'bg-blue-600 hover:bg-blue-700'
  };

  alertIcon.textContent = icons[type] || icons.info;
  alertTitle.textContent = title;
  alertMessage.textContent = message;
  
  // Configure buttons
  confirmBtn.textContent = confirmText;
  confirmBtn.className = `text-white font-bold py-2 px-4 rounded-lg transition-colors ${colors[type] || colors.info}`;
  
  if (type === 'confirm') {
    cancelBtn.textContent = cancelText;
    cancelBtn.classList.remove('hidden');
  } else {
    cancelBtn.classList.add('hidden');
  }

  // Create new elements to avoid multiple event listeners
  const newConfirmBtn = confirmBtn.cloneNode(true);
  const newCancelBtn = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  // Add new event listeners
  const closeModal = () => {
    const modalContent = alertModal.querySelector('.bg-white');
    modalContent.classList.add('custom-alert-hide');
    setTimeout(() => {
      alertModal.classList.add('hidden');
      alertModal.classList.remove('flex');
      modalContent.classList.remove('custom-alert-hide', 'custom-alert-show');
    }, 200);
  };

  newConfirmBtn.addEventListener('click', () => {
    closeModal();
    setTimeout(() => {
      if (onConfirm) onConfirm();
    }, 250);
  });

  newCancelBtn.addEventListener('click', () => {
    closeModal();
    setTimeout(() => {
      if (onCancel) onCancel();
    }, 250);
  });

  // Show modal with animation
  alertModal.classList.remove('hidden');
  alertModal.classList.add('flex');
  
  const modalContent = alertModal.querySelector('.bg-white');
  modalContent.classList.add('custom-alert-show');

  // Close on background click
  alertModal.addEventListener('click', (e) => {
    if (e.target === alertModal) {
      closeModal();
      setTimeout(() => {
        if (onCancel) onCancel();
      }, 250);
    }
  });

  // Close on Escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      setTimeout(() => {
        if (onCancel) onCancel();
      }, 250);
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);
}

// Validation helper functions
export function validateRequiredFields(form, requiredFields) {
  const missingFields = [];
  
  requiredFields.forEach(fieldId => {
    const field = form.querySelector(`#${fieldId}`);
    if (!field || !field.value.trim()) {
      const label = form.querySelector(`label[for="${fieldId}"]`) || 
                   form.querySelector(`label`);
      const fieldName = label ? label.textContent.replace('*', '').trim() : fieldId;
      missingFields.push(fieldName);
    }
  });
  
  return missingFields;
}

// Better number formatting for US Dollar (Ecuador)
export function formatCurrency(amount, options = {}) {
  const {
    showSymbol = true,
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    compact = false
  } = options;
  
  const numAmount = Number(amount || 0);
  
  // Para números muy grandes, usar notación compacta
  if (compact && numAmount >= 1000000) {
    return `$${(numAmount / 1000000).toFixed(1)}M`;
  }
  if (compact && numAmount >= 1000) {
    return `$${(numAmount / 1000).toFixed(0)}K`;
  }
  
  const formatter = new Intl.NumberFormat('en-US', {
    style: showSymbol ? 'currency' : 'decimal',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits
  });
  
  return formatter.format(numAmount);
}

// Format large numbers with K, M notation for mobile
export function formatCompactNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

// Debounce function for search and input optimization
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Check if device is mobile
export function isMobile() {
  return window.innerWidth < 768;
}

// Optimized date formatting
export function formatDate(dateString, options = {}) {
  if (!dateString) return 'N/A';
  
  const date = new Date(dateString);
  const { 
    includeTime = true, 
    compact = isMobile(),
    timeOnly = false
  } = options;
  
  if (timeOnly) {
    return date.toLocaleTimeString('es-CO', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true
    });
  }
  
  if (compact) {
    const dateStr = date.toLocaleDateString('es-CO', { 
      day: '2-digit', 
      month: '2-digit', 
      year: '2-digit' 
    });
    
    if (includeTime) {
      const timeStr = date.toLocaleTimeString('es-CO', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
      });
      return `${dateStr} ${timeStr}`;
    }
    return dateStr;
  }
  
  return includeTime ? 
    date.toLocaleString('es-CO', {
      year: 'numeric',
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }) : 
    date.toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
}

// ===== SISTEMA DE GUARDADO DE PROGRESO =====

// Guardar progreso de formulario
export function saveFormProgress(formId, formData) {
  const progressKey = `form_progress_${formId}`;
  const progressData = {
    formId,
    data: formData,
    timestamp: Date.now(),
    url: window.location.href
  };
  
  try {
    localStorage.setItem(progressKey, JSON.stringify(progressData));
    console.log(`✓ Progreso guardado para formulario: ${formId}`);
  } catch (error) {
    console.warn('Error guardando progreso:', error);
  }
}

// Restaurar progreso de formulario
export function restoreFormProgress(formId) {
  const progressKey = `form_progress_${formId}`;
  
  try {
    const saved = localStorage.getItem(progressKey);
    if (!saved) return null;
    
    const progressData = JSON.parse(saved);
    
    // Verificar que no sea muy antiguo (máximo 1 hora)
    const age = Date.now() - progressData.timestamp;
    const maxAge = 60 * 60 * 1000; // 1 hora
    
    if (age > maxAge) {
      localStorage.removeItem(progressKey);
      return null;
    }
    
    console.log(`✓ Progreso restaurado para formulario: ${formId}`);
    return progressData.data;
  } catch (error) {
    console.warn('Error restaurando progreso:', error);
    return null;
  }
}

// Limpiar progreso guardado
export function clearFormProgress(formId) {
  const progressKey = `form_progress_${formId}`;
  localStorage.removeItem(progressKey);
  console.log(`✓ Progreso limpiado para formulario: ${formId}`);
}

// Auto-guardar progreso mientras el usuario escribe
export function enableAutoSave(form, formId, intervalMs = 10000) {
  let autoSaveInterval;
  let hasChanges = false;
  
  // Detectar cambios en el formulario
  const inputs = form.querySelectorAll('input, select, textarea');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      hasChanges = true;
    });
    
    input.addEventListener('change', () => {
      hasChanges = true;
    });
  });
  
  // Auto-guardar cada X segundos si hay cambios
  autoSaveInterval = setInterval(() => {
    if (hasChanges) {
      const formData = getFormData(form);
      saveFormProgress(formId, formData);
      hasChanges = false;
    }
  }, intervalMs);
  
  // Limpiar interval cuando el formulario se envía exitosamente
  form.addEventListener('submit', () => {
    clearInterval(autoSaveInterval);
    // Limpiar progreso después de envío exitoso (con delay)
    setTimeout(() => clearFormProgress(formId), 1000);
  });
  
  // Guardar antes de salir de la página
  window.addEventListener('beforeunload', () => {
    if (hasChanges) {
      const formData = getFormData(form);
      saveFormProgress(formId, formData);
    }
    clearInterval(autoSaveInterval);
  });
  
  console.log(`✓ Auto-guardado habilitado para formulario: ${formId} (cada ${intervalMs/1000}s)`);
  return autoSaveInterval;
}

// Obtener datos del formulario
function getFormData(form) {
  const formData = {};
  const inputs = form.querySelectorAll('input, select, textarea');
  
  inputs.forEach(input => {
    if (input.type === 'checkbox') {
      formData[input.name || input.id] = input.checked;
    } else if (input.type === 'radio') {
      if (input.checked) {
        formData[input.name || input.id] = input.value;
      }
    } else {
      formData[input.name || input.id] = input.value;
    }
  });
  
  return formData;
}

// Restaurar datos al formulario
export function restoreFormData(form, formData) {
  if (!formData) return;
  
  Object.keys(formData).forEach(key => {
    const input = form.querySelector(`[name="${key}"], #${key}`);
    if (!input) return;
    
    if (input.type === 'checkbox') {
      input.checked = formData[key];
    } else if (input.type === 'radio') {
      if (input.value === formData[key]) {
        input.checked = true;
      }
    } else {
      input.value = formData[key];
    }
  });
  
  console.log(`✓ Datos restaurados en formulario`);
}

// Mostrar notificación de progreso restaurado
export function showProgressRestoredAlert(onRestore, onDiscard) {
  showCustomAlert({
    title: 'Progreso Recuperado',
    message: 'Se detectó progreso no guardado en este formulario.\n\n¿Desea restaurar los datos ingresados anteriormente?',
    type: 'confirm',
    confirmText: 'Restaurar',
    cancelText: 'Descartar',
    onConfirm: onRestore,
    onCancel: onDiscard
  });
}
