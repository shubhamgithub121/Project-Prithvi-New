import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJsApiLoader, GoogleMap, Marker, Autocomplete } from '@react-google-maps/api';
import { Clock, CheckCircle, ChevronRight, ChevronLeft, Loader2, IndianRupee } from 'lucide-react';

const libraries = ['places'];
const mapContainerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '0.5rem' // Matches Tailwind rounded-lg
};
const defaultCenter = { lat: 28.6139, lng: 77.2090 }; // Delhi default

const RATE_PER_KG = 15;

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

    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitted(true);
      setPickupId(`PU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`);
      setTimeout(() => navigate('/profile'), 5000);
    }, 2000);
  };

  const calculateEarnings = () => ((parseFloat(formData.estimatedWeight) || 0) * RATE_PER_KG).toFixed(2);

  const steps = ['Location', 'Details', 'Preview'];
  
  const inputClasses = "w-full bg-gray-900 border border-gray-700 rounded-lg p-4 text-white focus:outline-none focus:ring-2 focus:ring-green-600 focus:border-transparent transition-all";

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#121212] text-white p-4 md:p-8 flex items-center justify-center">
        <div className="max-w-md w-full bg-[#1e1e1e] rounded-2xl shadow-xl border border-gray-800 p-8 text-center">
          <div className="mx-auto w-20 h-20 bg-green-900/30 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Pickup Scheduled!</h2>
          <p className="text-gray-400 mb-6">Volunteers will arrive within 24 hours.</p>
          
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-8">
            <p className="text-sm text-gray-500 mb-1">Pickup ID</p>
            <p className="text-lg font-mono font-semibold text-white">{pickupId}</p>
          </div>

          <button
            onClick={() => navigate('/profile')}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-4 rounded-lg transition-colors"
          >
            View Profile / History
          </button>
          <p className="text-sm text-gray-500 mt-4">Redirecting automatically in 5 seconds...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#121212] text-white p-4 md:p-8 flex justify-center items-start">
      
      {/* Centered Form Container */}
      <div className="w-full max-w-3xl bg-[#1e1e1e] rounded-2xl shadow-xl border border-gray-800 p-6 md:p-10 mt-4 md:mt-10">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Schedule Plastic Pickup</h1>
          <p className="text-gray-400 text-sm">Earn ₹15/kg while helping the planet.</p>
        </div>

        {/* Proper Flexbox Stepper */}
        <div className="flex justify-between items-center mb-10 relative">
          {/* Connecting Line */}
          <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-700 -z-10 transform -translate-y-1/2"></div>
          
          {steps.map((step, index) => {
            const stepNum = index + 1;
            const isActive = currentStep === stepNum;
            const isPassed = currentStep > stepNum;

            return (
              <div key={step} className="flex flex-col items-center bg-[#1e1e1e] px-4">
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-colors duration-200
                  ${isActive ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(22,163,74,0.5)]' 
                    : isPassed ? 'bg-green-900 text-green-400 border border-green-700' 
                    : 'bg-gray-800 text-gray-500 border border-gray-700'}`}
                >
                  {isPassed ? '✓' : stepNum}
                </div>
                <span className={`mt-3 text-sm font-medium ${isActive ? 'text-white' : 'text-gray-500'}`}>
                  {step}
                </span>
              </div>
            );
          })}
        </div>

        {/* Form Content Area */}
        <div className="mt-8">
          {currentStep === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                Pickup Location
              </h2>
              
              {/* Google Maps Autocomplete Input Styling */}
              <div className="relative">
                {isLoaded ? (
                  <Autocomplete onLoad={(ref) => autocompleteRef.current = ref} onPlaceChanged={onPlaceChanged}>
                    <input 
                      type="text" 
                      name="address"
                      defaultValue={formData.address}
                      placeholder="Search Address..." 
                      className={`${inputClasses} ${errors.address ? 'border-red-500' : ''}`}
                    />
                  </Autocomplete>
                ) : (
                  <input 
                    type="text" 
                    placeholder="Loading Maps..." 
                    disabled
                    className={inputClasses}
                  />
                )}
                {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
              </div>

              {/* Map Container */}
              <div className="w-full h-64 bg-gray-900 rounded-lg border border-gray-700 flex items-center justify-center mt-4 overflow-hidden relative">
                {loadError ? (
                  <span className="text-red-400 text-sm px-4 text-center">Error loading maps. Check your API key and billing settings.</span>
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
                  <span className="text-gray-500">[ Loading Map... ]</span>
                )}
              </div>
            </div>
          )}
          
          {currentStep === 2 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                Pickup Details
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">City *</label>
                  <input
                    type="text"
                    name="city"
                    value={formData.city}
                    onChange={handleChange}
                    className={`${inputClasses} ${errors.city ? 'border-red-500' : ''}`}
                  />
                  {errors.city && <p className="text-red-500 text-sm mt-1">{errors.city}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Pincode *</label>
                  <input
                    type="text"
                    name="pincode"
                    value={formData.pincode}
                    onChange={handleChange}
                    maxLength={6}
                    className={`${inputClasses} ${errors.pincode ? 'border-red-500' : ''}`}
                  />
                  {errors.pincode && <p className="text-red-500 text-sm mt-1">{errors.pincode}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Preferred Date *</label>
                  <input
                    type="date"
                    name="pickupDate"
                    value={formData.pickupDate}
                    min={new Date().toISOString().split('T')[0]}
                    onChange={handleChange}
                    className={`${inputClasses} ${errors.pickupDate ? 'border-red-500' : ''}`}
                  />
                  {errors.pickupDate && <p className="text-red-500 text-sm mt-1">{errors.pickupDate}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Plastic Type</label>
                  <select
                    name="plasticType"
                    value={formData.plasticType}
                    onChange={handleChange}
                    className={inputClasses}
                  >
                    <option value="" className="bg-gray-900">Select type (Optional)</option>
                    <option value="pet" className="bg-gray-900">PET Bottles</option>
                    <option value="hdpe" className="bg-gray-900">HDPE (Containers)</option>
                    <option value="ldpe" className="bg-gray-900">LDPE (Bags)</option>
                    <option value="pp" className="bg-gray-900">PP (Packaging)</option>
                    <option value="mixed" className="bg-gray-900">Mixed Plastic</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Time Slot *</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: '8-12', label: '8 AM - 12 PM' },
                    { id: '12-16', label: '12 PM - 4 PM' },
                    { id: '16-20', label: '4 PM - 8 PM' }
                  ].map(slot => (
                    <label key={slot.id} className={`flex items-center justify-center gap-2 p-4 rounded-lg border cursor-pointer transition-colors ${formData.timeSlot === slot.id ? 'bg-green-900/30 border-green-500 text-green-400' : 'bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800'}`}>
                      <input type="radio" name="timeSlot" value={slot.id} checked={formData.timeSlot === slot.id} onChange={handleChange} className="sr-only" />
                      <Clock className="w-4 h-4" />
                      <span className="font-medium text-sm">{slot.label}</span>
                    </label>
                  ))}
                </div>
                {errors.timeSlot && <p className="text-red-500 text-sm mt-1">{errors.timeSlot}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">Estimated Weight (kg) *</label>
                <div className="flex items-center gap-4">
                  <button type="button" onClick={decrementWeight} className="w-14 h-14 rounded-lg border border-gray-700 flex items-center justify-center bg-gray-900 text-gray-300 hover:bg-gray-800 transition-colors text-xl font-medium">-</button>
                  <div className="flex-1 max-w-[140px]">
                    <input
                      type="number"
                      name="estimatedWeight"
                      value={formData.estimatedWeight}
                      onChange={handleChange}
                      min="0.5"
                      step="0.5"
                      className={`text-center ${inputClasses} ${errors.estimatedWeight ? 'border-red-500' : ''}`}
                    />
                  </div>
                  <button type="button" onClick={incrementWeight} className="w-14 h-14 rounded-lg border border-gray-700 flex items-center justify-center bg-gray-900 text-gray-300 hover:bg-gray-800 transition-colors text-xl font-medium">+</button>
                </div>
                {errors.estimatedWeight && <p className="text-red-500 text-sm mt-1">{errors.estimatedWeight}</p>}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Review & Confirm
              </h2>
              
              <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 space-y-4">
                <div className="flex justify-between items-start pb-4 border-b border-gray-800">
                  <div>
                    <p className="text-sm text-gray-500">Address</p>
                    <p className="font-medium text-white mt-1">{formData.address}</p>
                    <p className="text-sm text-gray-400">{formData.city}, {formData.pincode}</p>
                  </div>
                  <button onClick={() => setCurrentStep(1)} className="text-green-500 hover:text-green-400 text-sm font-medium">Edit</button>
                </div>

                <div className="grid grid-cols-2 gap-4 pb-4 border-b border-gray-800">
                  <div>
                    <p className="text-sm text-gray-500">Date & Time</p>
                    <p className="font-medium text-white mt-1">{formData.pickupDate}</p>
                    <p className="text-sm text-gray-400">
                      {formData.timeSlot === '8-12' ? '8 AM - 12 PM' : formData.timeSlot === '12-16' ? '12 PM - 4 PM' : '4 PM - 8 PM'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Plastic Info</p>
                    <p className="font-medium text-white mt-1">{formData.estimatedWeight} kg</p>
                    <p className="text-sm text-gray-400 capitalize">{formData.plasticType || 'Mixed'}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 rounded-lg bg-green-900/20 border border-green-900/50 text-green-400">
                  <div className="flex items-center gap-2">
                    <IndianRupee className="w-5 h-5" />
                    <span className="font-medium">Estimated Earnings</span>
                  </div>
                  <div className="text-xl font-bold">₹{calculateEarnings()}</div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between gap-4 mt-10">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handlePrev}
                className="flex-1 max-w-[140px] flex items-center justify-center gap-2 px-4 py-4 rounded-lg border border-gray-700 text-gray-300 font-medium hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" /> Back
              </button>
            ) : <div className="flex-1 max-w-[140px]"></div>}
            
            {currentStep < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 max-w-[140px] flex items-center justify-center gap-2 px-4 py-4 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors ml-auto"
              >
                Next <ChevronRight className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-4 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition-colors ml-auto disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
                ) : (
                  <><CheckCircle className="w-5 h-5" /> Confirm Pickup</>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default SchedulePickup;
