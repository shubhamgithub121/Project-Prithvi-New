import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJsApiLoader, GoogleMap, Marker, Autocomplete } from '@react-google-maps/api';
import { Clock, CheckCircle, ChevronRight, ChevronLeft, Loader2, IndianRupee } from 'lucide-react';
import { apiPost } from '../lib/apiClient';
import './SchedulePickup.css';

const libraries = ['places'];
const mapContainerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '12px' // matches the app's .card border-radius
};
const defaultCenter = { lat: 28.6139, lng: 77.2090 }; // Delhi default

const RATE_PER_KG = 15;

const TIME_SLOTS = [
  { id: '8-12', label: '8 AM - 12 PM' },
  { id: '12-16', label: '12 PM - 4 PM' },
  { id: '16-20', label: '4 PM - 8 PM' }
];

const SchedulePickup = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickupId, setPickupId] = useState('');

  const [formData, setFormData] = useState({
    address: '',
    city: '',
    pincode: '',
    lat: defaultCenter.lat,
    lng: defaultCenter.lng,
    pickupDate: '',
    timeSlot: '',
    plasticType: '',
    estimatedWeight: 5
  });

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries
  });

  const autocompleteRef = useRef(null);

  const onPlaceChanged = () => {
    if (autocompleteRef.current !== null) {
      const place = autocompleteRef.current.getPlace();
      if (!place.geometry) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      let city = '';
      let pincode = '';

      place.address_components?.forEach(component => {
        if (component.types.includes('locality')) {
          city = component.long_name;
        }
        if (component.types.includes('postal_code')) {
          pincode = component.long_name;
        }
      });

      setFormData(prev => ({
        ...prev,
        address: place.formatted_address || place.name,
        lat,
        lng,
        city: city || prev.city,
        pincode: pincode || prev.pincode
      }));
      setErrors(prev => ({ ...prev, address: null, city: null, pincode: null }));
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
  };

  const incrementWeight = () => setFormData(prev => ({ ...prev, estimatedWeight: parseFloat((prev.estimatedWeight + 0.5).toFixed(1)) }));
  const decrementWeight = () => {
    if (formData.estimatedWeight > 0.5) {
      setFormData(prev => ({ ...prev, estimatedWeight: parseFloat((prev.estimatedWeight - 0.5).toFixed(1)) }));
    }
  };

  const validateStep = (step) => {
    const newErrors = {};
    if (step === 1) {
      if (!formData.address) newErrors.address = 'Please select a pickup address via the map search';
    } else if (step === 2) {
      if (!formData.city) newErrors.city = 'City is required';
      if (!formData.pincode) {
        newErrors.pincode = 'Pincode is required';
      } else if (!/^[0-9]{6}$/.test(formData.pincode)) {
        newErrors.pincode = 'Please enter a valid 6-digit pincode';
      }
      if (!formData.pickupDate) newErrors.pickupDate = 'Pickup date is required';
      if (!formData.timeSlot) newErrors.timeSlot = 'Time slot is required';
      if (formData.estimatedWeight < 0.5) newErrors.estimatedWeight = 'Minimum weight is 0.5kg';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) setCurrentStep(prev => prev + 1);
  };
  const handlePrev = () => setCurrentStep(prev => prev - 1);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateStep(2)) return;

    setSubmitError('');
    setIsSubmitting(true);
    try {
      const pickup = await apiPost('/api/pickups/', {
        address: formData.address,
        city: formData.city,
        pincode: formData.pincode,
        lat: formData.lat,
        lng: formData.lng,
        pickup_date: formData.pickupDate,
        time_slot: formData.timeSlot,
        plastic_type: formData.plasticType,
        estimated_weight_kg: parseFloat(formData.estimatedWeight),
      });
      setIsSubmitting(false);
      setSubmitted(true);
      setPickupId(`PU-${pickup.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`);
      setTimeout(() => navigate('/profile'), 5000);
    } catch (err) {
      setIsSubmitting(false);
      setSubmitError(err.message || 'Failed to schedule pickup. Please try again.');
    }
  };

  const calculateEarnings = () => ((parseFloat(formData.estimatedWeight) || 0) * RATE_PER_KG).toFixed(2);

  const steps = ['Location', 'Details', 'Preview'];
  const progressPercent = ((currentStep - 1) / (steps.length - 1)) * 100;

  if (submitted) {
    return (
      <div className="schedule-page">
        <div className="container schedule-success-wrap">
          <div className="card schedule-success-card">
            <div className="success-icon-circle">
              <CheckCircle className="success-icon" />
            </div>
            <h2 className="success-title">Pickup Scheduled!</h2>
            <p className="success-subtitle">Volunteers will arrive within 24 hours.</p>

            <div className="pickup-id-box">
              <p className="pickup-id-label">Pickup ID</p>
              <p className="pickup-id-value">{pickupId}</p>
            </div>

            <button
              onClick={() => navigate('/profile')}
              className="btn btn-primary schedule-full-btn"
            >
              View Profile / History
            </button>
            <p className="redirect-note">Redirecting automatically in 5 seconds...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-page">
      <div className="container">
        <div className="schedule-card card">

          <div className="schedule-header">
            <h1 className="schedule-title">Schedule Plastic Pickup</h1>
            <p className="schedule-subtitle">Earn ₹{RATE_PER_KG}/kg while helping the planet.</p>
          </div>

          {/* Stepper */}
          <div className="stepper">
            <div className="stepper-track" />
            <div className="stepper-track-fill" style={{ width: `${progressPercent}%` }} />

            {steps.map((step, index) => {
              const stepNum = index + 1;
              const isActive = currentStep === stepNum;
              const isPassed = currentStep > stepNum;

              return (
                <div key={step} className="step-item">
                  <div className={`step-circle ${isActive ? 'active' : ''} ${isPassed ? 'passed' : ''}`}>
                    {isPassed ? '✓' : stepNum}
                  </div>
                  <span className={`step-label ${isActive ? 'active' : ''}`}>{step}</span>
                </div>
              );
            })}
          </div>

          {/* Step content */}
          <div className="step-content">
            {currentStep === 1 && (
              <div className="form-section">
                <h2 className="form-section-title">
                  <span className="form-section-icon" aria-hidden="true">📍</span>
                  Pickup Location
                </h2>

                <div className="address-field">
                  {isLoaded ? (
                    <Autocomplete onLoad={(ref) => autocompleteRef.current = ref} onPlaceChanged={onPlaceChanged}>
                      <input
                        type="text"
                        name="address"
                        defaultValue={formData.address}
                        placeholder="Search Address..."
                        className={`input-field ${errors.address ? 'input-error' : ''}`}
                      />
                    </Autocomplete>
                  ) : (
                    <input
                      type="text"
                      placeholder="Loading Maps..."
                      disabled
                      className="input-field"
                    />
                  )}
                  {errors.address && <p className="field-error">{errors.address}</p>}
                </div>

                <div className="map-frame">
                  {loadError ? (
                    <span className="map-message map-message-error">Error loading maps. Check your API key and billing settings.</span>
                  ) : isLoaded ? (
                    <GoogleMap
                      mapContainerStyle={mapContainerStyle}
                      center={{ lat: formData.lat, lng: formData.lng }}
                      zoom={15}
                      options={{ disableDefaultUI: true, gestureHandling: 'cooperative' }}
                    >
                      <Marker position={{ lat: formData.lat, lng: formData.lng }} />
                    </GoogleMap>
                  ) : (
                    <span className="map-message">Loading Map...</span>
                  )}
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <div className="form-section">
                <h2 className="form-section-title">
                  <span className="form-section-icon" aria-hidden="true">📝</span>
                  Pickup Details
                </h2>

                <div className="field-grid">
                  <div className="form-group">
                    <label>City *</label>
                    <input
                      type="text"
                      name="city"
                      value={formData.city}
                      onChange={handleChange}
                      className={`input-field ${errors.city ? 'input-error' : ''}`}
                    />
                    {errors.city && <p className="field-error">{errors.city}</p>}
                  </div>
                  <div className="form-group">
                    <label>Pincode *</label>
                    <input
                      type="text"
                      name="pincode"
                      value={formData.pincode}
                      onChange={handleChange}
                      maxLength={6}
                      className={`input-field ${errors.pincode ? 'input-error' : ''}`}
                    />
                    {errors.pincode && <p className="field-error">{errors.pincode}</p>}
                  </div>
                  <div className="form-group">
                    <label>Preferred Date *</label>
                    <input
                      type="date"
                      name="pickupDate"
                      value={formData.pickupDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={handleChange}
                      className={`input-field ${errors.pickupDate ? 'input-error' : ''}`}
                    />
                    {errors.pickupDate && <p className="field-error">{errors.pickupDate}</p>}
                  </div>
                  <div className="form-group">
                    <label>Plastic Type</label>
                    <select
                      name="plasticType"
                      value={formData.plasticType}
                      onChange={handleChange}
                      className="input-field"
                    >
                      <option value="">Select type (Optional)</option>
                      <option value="pet">PET Bottles</option>
                      <option value="hdpe">HDPE (Containers)</option>
                      <option value="ldpe">LDPE (Bags)</option>
                      <option value="pp">PP (Packaging)</option>
                      <option value="mixed">Mixed Plastic</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label>Time Slot *</label>
                  <div className="time-slot-grid">
                    {TIME_SLOTS.map(slot => (
                      <label
                        key={slot.id}
                        className={`time-slot-option ${formData.timeSlot === slot.id ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="timeSlot"
                          value={slot.id}
                          checked={formData.timeSlot === slot.id}
                          onChange={handleChange}
                          className="time-slot-radio"
                        />
                        <Clock className="time-slot-icon" />
                        <span>{slot.label}</span>
                      </label>
                    ))}
                  </div>
                  {errors.timeSlot && <p className="field-error">{errors.timeSlot}</p>}
                </div>

                <div className="form-group">
                  <label>Estimated Weight (kg) *</label>
                  <div className="weight-control">
                    <button type="button" onClick={decrementWeight} className="weight-btn">-</button>
                    <input
                      type="number"
                      name="estimatedWeight"
                      value={formData.estimatedWeight}
                      onChange={handleChange}
                      min="0.5"
                      step="0.5"
                      className={`input-field weight-input ${errors.estimatedWeight ? 'input-error' : ''}`}
                    />
                    <button type="button" onClick={incrementWeight} className="weight-btn">+</button>
                  </div>
                  {errors.estimatedWeight && <p className="field-error">{errors.estimatedWeight}</p>}
                </div>
              </div>
            )}

            {currentStep === 3 && (
              <div className="form-section">
                <h2 className="form-section-title">
                  <CheckCircle className="form-section-title-icon" />
                  Review & Confirm
                </h2>

                <div className="review-card">
                  <div className="review-row">
                    <div>
                      <p className="review-label">Address</p>
                      <p className="review-value">{formData.address}</p>
                      <p className="review-sub">{formData.city}, {formData.pincode}</p>
                    </div>
                    <button type="button" onClick={() => setCurrentStep(1)} className="review-edit-btn">Edit</button>
                  </div>

                  <div className="review-grid">
                    <div>
                      <p className="review-label">Date & Time</p>
                      <p className="review-value">{formData.pickupDate}</p>
                      <p className="review-sub">
                        {TIME_SLOTS.find(s => s.id === formData.timeSlot)?.label}
                      </p>
                    </div>
                    <div>
                      <p className="review-label">Plastic Info</p>
                      <p className="review-value">{formData.estimatedWeight} kg</p>
                      <p className="review-sub">{formData.plasticType || 'Mixed'}</p>
                    </div>
                  </div>

                  <div className="earnings-banner">
                    <div className="earnings-label">
                      <IndianRupee className="earnings-icon" />
                      <span>Estimated Earnings</span>
                    </div>
                    <div className="earnings-value">₹{calculateEarnings()}</div>
                  </div>
                </div>
              </div>
            )}

            {submitError && (
              <div className="form-error-banner">{submitError}</div>
            )}

            {/* Navigation Buttons */}
            <div className="nav-buttons">
              {currentStep > 1 ? (
                <button type="button" onClick={handlePrev} className="btn btn-secondary nav-btn">
                  <ChevronLeft className="nav-btn-icon" /> Back
                </button>
              ) : <span className="nav-spacer" />}

              {currentStep < 3 ? (
                <button type="button" onClick={handleNext} className="btn btn-primary nav-btn nav-btn-end">
                  Next <ChevronRight className="nav-btn-icon" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="btn btn-primary nav-btn nav-btn-end nav-btn-submit"
                >
                  {isSubmitting ? (
                    <><Loader2 className="nav-btn-icon spin" /> Processing...</>
                  ) : (
                    <><CheckCircle className="nav-btn-icon" /> Confirm Pickup</>
                  )}
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default SchedulePickup;
