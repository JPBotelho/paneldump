import React from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppRootProps } from '@grafana/data';
import PageParse from '../../pages/PageParse';

function App(props: AppRootProps) {
  return (
    <Routes>      
      <Route path="*" element={<PageParse />} />
    </Routes>
  );
}

export default App;
